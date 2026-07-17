#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment
init_compose_command

fail() {
  echo "Backup failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

for command_name in docker flock python3 sha256sum tar; do
  require_command "$command_name"
done

if is_production_deployment; then
  ENV_FILE="$ENV_FILE" "$ROOT_DIR/scripts/check-production-env.sh" >/dev/null
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fleet-tracking}"
POSTGRES_USER="${POSTGRES_USER:-fleet_tracking}"
POSTGRES_DB="${POSTGRES_DB:-fleet_tracking}"
MEDIA_STORAGE_BACKEND="${MEDIA_STORAGE_BACKEND:-local}"
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.24.1}"
BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] ||
  fail "BACKUP_RETENTION_DAYS must be a non-negative integer"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail "another backup is already running"

STAGING_DIR="$(mktemp -d "$BACKUP_DIR/.staging-${BACKUP_ID}-XXXXXX")"
PLAIN_BUNDLE="$BACKUP_DIR/.${BACKUP_ID}.tar.gz"
app_stopped=false
declare -a running_services=()

restart_application() {
  if [ "$app_stopped" = true ] && [ "${#running_services[@]}" -gt 0 ]; then
    echo "Restarting previously running application services..."
    "${COMPOSE[@]}" up -d "${running_services[@]}" >/dev/null
    app_stopped=false
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  restart_application || true
  rm -rf "$STAGING_DIR" "$PLAIN_BUNDLE"
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$BACKUP_ENCRYPTION" in
  age)
    require_command age
    [ -n "${AGE_RECIPIENT:-}" ] || fail "AGE_RECIPIENT is required"
    FINAL_BUNDLE="$BACKUP_DIR/fleet-backup-${BACKUP_ID}.tar.gz.age"
    ;;
  gpg)
    require_command gpg
    [ -n "${GPG_RECIPIENT:-}" ] || fail "GPG_RECIPIENT is required"
    FINAL_BUNDLE="$BACKUP_DIR/fleet-backup-${BACKUP_ID}.tar.gz.gpg"
    ;;
  *)
    fail "BACKUP_ENCRYPTION must be configured as age or gpg"
    ;;
esac

mapfile -t app_services < <(deployment_app_services)
running_output="$("${COMPOSE[@]}" ps --services --filter status=running)"
for service in "${app_services[@]}"; do
  if [[ $'\n'"$running_output"$'\n' == *$'\n'"$service"$'\n'* ]]; then
    running_services+=("$service")
  fi
done

if [ "${#running_services[@]}" -gt 0 ]; then
  echo "Quiescing application writes for a consistent database/media backup..."
  "${COMPOSE[@]}" stop -t 60 "${running_services[@]}" >/dev/null
  app_stopped=true
fi

echo "Creating PostgreSQL custom-format dump..."
"${COMPOSE[@]}" exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"$STAGING_DIR/database.dump"
"${COMPOSE[@]}" exec -T db pg_restore --list <"$STAGING_DIR/database.dump" >/dev/null

archive_volume() {
  local volume_name="$1"
  local output_name="$2"
  docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
    --env "OUTPUT_NAME=$output_name" \
    --env "OUTPUT_UID=$(id -u)" \
    --env "OUTPUT_GID=$(id -g)" \
    --volume "$volume_name:/source:ro" \
    --volume "$STAGING_DIR:/output" \
    "$BACKUP_HELPER_IMAGE" \
    sh -eu -c \
    'tar -czf "/output/$OUTPUT_NAME" -C /source . &&
     chown "$OUTPUT_UID:$OUTPUT_GID" "/output/$OUTPUT_NAME"'
}

media_included=false
if [ "$MEDIA_STORAGE_BACKEND" = local ]; then
  echo "Creating local media archive..."
  archive_volume "${COMPOSE_PROJECT_NAME}_media_data" media.tar.gz
  media_included=true
elif [ -n "${BACKUP_REMOTE_MEDIA_HOOK:-}" ]; then
  [ -x "$BACKUP_REMOTE_MEDIA_HOOK" ] ||
    fail "BACKUP_REMOTE_MEDIA_HOOK must be an executable path"
  echo "Exporting remote media through the configured hook..."
  "$BACKUP_REMOTE_MEDIA_HOOK" "$STAGING_DIR/media.tar.gz"
  [ -s "$STAGING_DIR/media.tar.gz" ] ||
    fail "remote media hook did not create media.tar.gz"
  media_included=true
else
  fail "remote media requires BACKUP_REMOTE_MEDIA_HOOK to create a consistent media archive"
fi

caddy_included=false
if is_production_deployment; then
  echo "Archiving Caddy certificate and ACME state..."
  archive_volume "${COMPOSE_PROJECT_NAME}_caddy_data" caddy-data.tar.gz
  archive_volume "${COMPOSE_PROJECT_NAME}_caddy_config" caddy-config.tar.gz
  caddy_included=true
fi

git_revision="$(git rev-parse --verify HEAD 2>/dev/null || printf unknown)"
topology=development
if is_production_deployment; then
  topology=production-tls
fi

BACKUP_ID="$BACKUP_ID" \
CREATED_AT="$CREATED_AT" \
GIT_REVISION="$git_revision" \
POSTGRES_DB="$POSTGRES_DB" \
MEDIA_STORAGE_BACKEND="$MEDIA_STORAGE_BACKEND" \
MEDIA_INCLUDED="$media_included" \
CADDY_INCLUDED="$caddy_included" \
TOPOLOGY="$topology" \
python3 - "$STAGING_DIR/metadata.json" <<'PY'
import json
import os
import sys

metadata = {
    "format_version": 1,
    "backup_id": os.environ["BACKUP_ID"],
    "created_at_utc": os.environ["CREATED_AT"],
    "git_revision": os.environ["GIT_REVISION"],
    "database_name": os.environ["POSTGRES_DB"],
    "database_dump": "database.dump",
    "media_backend": os.environ["MEDIA_STORAGE_BACKEND"],
    "media_included": os.environ["MEDIA_INCLUDED"] == "true",
    "caddy_state_included": os.environ["CADDY_INCLUDED"] == "true",
    "compose_topology": os.environ["TOPOLOGY"],
    "consistency": "application-writes-quiesced",
}
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(metadata, output, indent=2, sort_keys=True)
    output.write("\n")
PY

mapfile -t component_files < <(
  cd "$STAGING_DIR"
  for file in database.dump media.tar.gz caddy-data.tar.gz caddy-config.tar.gz metadata.json; do
    [ ! -f "$file" ] || printf '%s\n' "$file"
  done
)
(
  cd "$STAGING_DIR"
  sha256sum "${component_files[@]}" >manifest.sha256
  tar -czf "$PLAIN_BUNDLE" "${component_files[@]}" manifest.sha256
)

echo "Encrypting authenticated backup bundle with $BACKUP_ENCRYPTION..."
if [ "$BACKUP_ENCRYPTION" = age ]; then
  age --recipient "$AGE_RECIPIENT" --output "$FINAL_BUNDLE" "$PLAIN_BUNDLE"
else
  gpg --batch --yes --trust-model always \
    --recipient "$GPG_RECIPIENT" \
    --output "$FINAL_BUNDLE" \
    --encrypt "$PLAIN_BUNDLE"
fi

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$FINAL_BUNDLE")" >"$(basename "$FINAL_BUNDLE").sha256"
)
chmod 600 "$FINAL_BUNDLE" "$FINAL_BUNDLE.sha256"
sync -f "$FINAL_BUNDLE" "$FINAL_BUNDLE.sha256" 2>/dev/null || sync

restart_application

offsite_status=not_configured
offsite_exit=0
if [ -n "${BACKUP_OFFSITE_HOOK:-}" ]; then
  [ -x "$BACKUP_OFFSITE_HOOK" ] ||
    fail "BACKUP_OFFSITE_HOOK must be an executable path"
  echo "Sending encrypted bundle through offsite hook..."
  if "$BACKUP_OFFSITE_HOOK" "$FINAL_BUNDLE" "$FINAL_BUNDLE.sha256"; then
    offsite_status=ok
  else
    offsite_status=failed
    offsite_exit=1
  fi
fi

cutoff_epoch="$(date -u -d "$BACKUP_RETENTION_DAYS days ago" +%s)"
shopt -s nullglob
for old_bundle in "$BACKUP_DIR"/fleet-backup-*.tar.gz.age "$BACKUP_DIR"/fleet-backup-*.tar.gz.gpg; do
  [ "$old_bundle" = "$FINAL_BUNDLE" ] && continue
  if [ "$(stat -c %Y "$old_bundle")" -lt "$cutoff_epoch" ]; then
    rm -f "$old_bundle" "$old_bundle.sha256"
  fi
done
shopt -u nullglob

bundle_size="$(stat -c %s "$FINAL_BUNDLE")"
bundle_checksum="$(sha256sum "$FINAL_BUNDLE" | awk '{print $1}')"
status_tmp="$BACKUP_DIR/.last-backup-status.json.tmp"
BACKUP_ID="$BACKUP_ID" \
CREATED_AT="$CREATED_AT" \
FINAL_BUNDLE="$FINAL_BUNDLE" \
BUNDLE_SIZE="$bundle_size" \
BUNDLE_CHECKSUM="$bundle_checksum" \
BACKUP_ENCRYPTION="$BACKUP_ENCRYPTION" \
OFFSITE_STATUS="$offsite_status" \
python3 - "$status_tmp" <<'PY'
import json
import os
import sys

status = {
    "backup_id": os.environ["BACKUP_ID"],
    "created_at_utc": os.environ["CREATED_AT"],
    "bundle": os.environ["FINAL_BUNDLE"],
    "size_bytes": int(os.environ["BUNDLE_SIZE"]),
    "sha256": os.environ["BUNDLE_CHECKSUM"],
    "encryption": os.environ["BACKUP_ENCRYPTION"],
    "offsite_status": os.environ["OFFSITE_STATUS"],
}
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(status, output, indent=2, sort_keys=True)
    output.write("\n")
PY
chmod 600 "$status_tmp"
mv -f "$status_tmp" "$BACKUP_DIR/last-backup-status.json"

echo "Encrypted backup complete: $FINAL_BUNDLE"
echo "Ciphertext checksum: $FINAL_BUNDLE.sha256"
if [ "$offsite_exit" -ne 0 ]; then
  fail "local backup succeeded, but the offsite hook failed"
fi

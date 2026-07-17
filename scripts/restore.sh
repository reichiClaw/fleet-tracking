#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$2" != "--confirm" ]; }; then
  echo "Usage: $0 <encrypted-backup-bundle> [--confirm]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment
init_compose_command

fail() {
  echo "Restore failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

for command_name in docker flock python3 sha256sum; do
  require_command "$command_name"
done

if is_production_deployment; then
  ENV_FILE="$ENV_FILE" "$ROOT_DIR/scripts/check-production-env.sh" >/dev/null
fi

[ -f "$1" ] || fail "encrypted bundle not found: $1"
BUNDLE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -f "$BUNDLE.sha256" ] || fail "ciphertext checksum file not found: $BUNDLE.sha256"
(
  cd "$(dirname "$BUNDLE")"
  sha256sum --check --status "$(basename "$BUNDLE").sha256"
) || fail "ciphertext checksum validation failed"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fleet-tracking}"
POSTGRES_USER="${POSTGRES_USER:-fleet_tracking}"
POSTGRES_DB="${POSTGRES_DB:-fleet_tracking}"
MEDIA_STORAGE_BACKEND="${MEDIA_STORAGE_BACKEND:-local}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.24.1}"
RESTORE_ROOT="${RESTORE_STAGING_DIR:-$(dirname "$BUNDLE")}"

[[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
  fail "POSTGRES_USER contains unsupported characters"
[[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
  fail "POSTGRES_DB contains unsupported characters"

mkdir -p "$RESTORE_ROOT"
chmod 700 "$RESTORE_ROOT"
RESTORE_ROOT="$(cd "$RESTORE_ROOT" && pwd)"
exec 9>"$RESTORE_ROOT/.restore.lock"
flock -n 9 || fail "another restore is already running"

RESTORE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
SUFFIX="$(date -u +%Y%m%d%H%M%S)"
WORK_DIR="$(mktemp -d "$RESTORE_ROOT/.restore-${RESTORE_ID}-XXXXXX")"
PLAIN_BUNDLE="$WORK_DIR/bundle.tar.gz"
EXTRACTED_DIR="$WORK_DIR/extracted"
STAGING_DB="${POSTGRES_DB:0:35}_restore_${SUFFIX}"
ROLLBACK_DB="${POSTGRES_DB:0:34}_rollback_${SUFFIX}"
FAILED_DB="${POSTGRES_DB:0:36}_failed_${SUFFIX}"
app_stopped=false
cutover_started=false
cutover_complete=false
stage_db_exists=false
database_swapped=false
old_database_renamed=false
remote_media_staged=false
volume_cutover_count=0
declare -a running_services=()
declare -a stage_volumes=()
declare -a stable_volumes=()
declare -a rollback_volumes=()

restart_application() {
  if [ "$app_stopped" = true ] && [ "${#running_services[@]}" -gt 0 ]; then
    "${COMPOSE[@]}" up -d "${running_services[@]}" >/dev/null
    app_stopped=false
  fi
}

clear_and_copy_volume() {
  local source_volume="$1"
  local destination_volume="$2"
  docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --cap-add FOWNER \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
    --volume "$source_volume:/source:ro" \
    --volume "$destination_volume:/destination" \
    "$BACKUP_HELPER_IMAGE" \
    sh -eu -c \
    'find /destination -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +;
     tar -C /source -cf - . | tar -C /destination -xf -'
}

database_exists() {
  "${COMPOSE[@]}" exec -T db psql \
    --username "$POSTGRES_USER" \
    --dbname postgres \
    --tuples-only \
    --no-align \
    --command "SELECT 1 FROM pg_database WHERE datname = '$1'" |
    awk 'NF { found=1 } END { exit !found }'
}

rollback_cutover() {
  local index
  echo "Cutover failed; restoring preserved database and volumes..." >&2
  if [ "$app_stopped" = false ] && [ "${#running_services[@]}" -gt 0 ]; then
    "${COMPOSE[@]}" stop -t 60 "${running_services[@]}" >/dev/null 2>&1 || true
    app_stopped=true
  fi
  if [ "$remote_media_staged" = true ]; then
    "$RESTORE_REMOTE_MEDIA_HOOK" rollback "$EXTRACTED_DIR/media.tar.gz" "$RESTORE_ID" || true
    remote_media_staged=false
  fi
  for ((index = 0; index < volume_cutover_count; index++)); do
    if docker volume inspect "${rollback_volumes[$index]}" >/dev/null 2>&1; then
      clear_and_copy_volume "${rollback_volumes[$index]}" "${stable_volumes[$index]}" || true
    fi
  done
  if [ "$database_swapped" = true ]; then
    "${COMPOSE[@]}" exec -T db psql \
      --username "$POSTGRES_USER" \
      --dbname postgres \
      --set ON_ERROR_STOP=1 \
      --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
      >/dev/null || true
    if database_exists "$FAILED_DB"; then
      "${COMPOSE[@]}" exec -T db dropdb --username "$POSTGRES_USER" "$FAILED_DB" || true
    fi
    "${COMPOSE[@]}" exec -T db psql \
      --username "$POSTGRES_USER" \
      --dbname postgres \
      --set ON_ERROR_STOP=1 \
      --command "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$FAILED_DB\";" \
      --command "ALTER DATABASE \"$ROLLBACK_DB\" RENAME TO \"$POSTGRES_DB\";" \
      >/dev/null || true
    database_swapped=false
    old_database_renamed=false
  elif [ "$old_database_renamed" = true ]; then
    "${COMPOSE[@]}" exec -T db psql \
      --username "$POSTGRES_USER" \
      --dbname postgres \
      --set ON_ERROR_STOP=1 \
      --command "ALTER DATABASE \"$ROLLBACK_DB\" RENAME TO \"$POSTGRES_DB\";" \
      >/dev/null || true
    old_database_renamed=false
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [ "$cutover_started" = true ] && [ "$cutover_complete" = false ]; then
    rollback_cutover
  elif [ "$remote_media_staged" = true ] && [ "$cutover_complete" = false ]; then
    "$RESTORE_REMOTE_MEDIA_HOOK" rollback "$EXTRACTED_DIR/media.tar.gz" "$RESTORE_ID" || true
  fi
  if [ "$stage_db_exists" = true ] && database_exists "$STAGING_DB"; then
    "${COMPOSE[@]}" exec -T db dropdb --username "$POSTGRES_USER" "$STAGING_DB" || true
  fi
  restart_application || true
  for volume in "${stage_volumes[@]}"; do
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$BUNDLE" in
  *.age)
    require_command age
    [ -n "${AGE_IDENTITY_FILE:-}" ] || fail "AGE_IDENTITY_FILE is required to decrypt this backup"
    [ -f "$AGE_IDENTITY_FILE" ] || fail "age identity file not found: $AGE_IDENTITY_FILE"
    identity_mode="$(stat -c '%a' "$AGE_IDENTITY_FILE")"
    (( (8#$identity_mode & 8#077) == 0 )) ||
      fail "age identity file must not be accessible by group or others"
    age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$PLAIN_BUNDLE" "$BUNDLE"
    ;;
  *.gpg)
    require_command gpg
    gpg --batch --yes --output "$PLAIN_BUNDLE" --decrypt "$BUNDLE"
    ;;
  *)
    fail "bundle extension must be .age or .gpg"
    ;;
esac

echo "Validating decrypted archive, component checksums, and safe paths..."
python3 "$ROOT_DIR/scripts/validate-backup.py" \
  "$PLAIN_BUNDLE" \
  --extract "$EXTRACTED_DIR"
"${COMPOSE[@]}" up -d db >/dev/null

echo "Waiting for PostgreSQL readiness..."
db_ready=false
for _ in {1..60}; do
  if "${COMPOSE[@]}" exec -T db pg_isready \
    --username "$POSTGRES_USER" \
    --dbname postgres >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 2
done
[ "$db_ready" = true ] || fail "PostgreSQL did not become ready within 120 seconds"

"${COMPOSE[@]}" exec -T db pg_restore --list \
  <"$EXTRACTED_DIR/database.dump" >/dev/null ||
  fail "pg_restore rejected the database dump"

echo "Restoring and verifying temporary database $STAGING_DB..."
database_exists "$STAGING_DB" &&
  "${COMPOSE[@]}" exec -T db dropdb --username "$POSTGRES_USER" "$STAGING_DB"
"${COMPOSE[@]}" exec -T db createdb --username "$POSTGRES_USER" "$STAGING_DB"
stage_db_exists=true
"${COMPOSE[@]}" exec -T db pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$STAGING_DB" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  <"$EXTRACTED_DIR/database.dump"
migration_count="$("${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname "$STAGING_DB" \
  --tuples-only \
  --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM django_migrations;")"
[[ "$migration_count" =~ ^[[:space:]]*[1-9][0-9]*[[:space:]]*$ ]] ||
  fail "temporary database is missing Django migration history"

restore_archive_to_volume() {
  local archive_path="$1"
  local volume_name="$2"
  docker volume create "$volume_name" >/dev/null
  docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --cap-add FOWNER \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
    --volume "$archive_path:/restore/archive.tar.gz:ro" \
    --volume "$volume_name:/destination" \
    "$BACKUP_HELPER_IMAGE" \
    sh -eu -c 'tar -xzf /restore/archive.tar.gz -C /destination'
}

add_staged_volume() {
  local archive_name="$1"
  local logical_name="$2"
  local archive_path="$EXTRACTED_DIR/$archive_name"
  [ -f "$archive_path" ] || return 0
  local stable="${COMPOSE_PROJECT_NAME}_${logical_name}"
  local stage="${COMPOSE_PROJECT_NAME}_${logical_name}_restore_${SUFFIX}"
  local rollback="${COMPOSE_PROJECT_NAME}_${logical_name}_rollback_${SUFFIX}"
  restore_archive_to_volume "$archive_path" "$stage"
  stage_volumes+=("$stage")
  stable_volumes+=("$stable")
  rollback_volumes+=("$rollback")
}

if [ "$MEDIA_STORAGE_BACKEND" = local ]; then
  [ -f "$EXTRACTED_DIR/media.tar.gz" ] ||
    fail "local-media deployment requires media.tar.gz in the backup"
  add_staged_volume media.tar.gz media_data
else
  [ -n "${RESTORE_REMOTE_MEDIA_HOOK:-}" ] ||
    fail "remote media restore requires RESTORE_REMOTE_MEDIA_HOOK"
  [ -x "$RESTORE_REMOTE_MEDIA_HOOK" ] ||
    fail "RESTORE_REMOTE_MEDIA_HOOK must be executable"
  "$RESTORE_REMOTE_MEDIA_HOOK" stage "$EXTRACTED_DIR/media.tar.gz" "$RESTORE_ID"
  "$RESTORE_REMOTE_MEDIA_HOOK" verify "$EXTRACTED_DIR/media.tar.gz" "$RESTORE_ID"
  remote_media_staged=true
fi

if is_production_deployment; then
  add_staged_volume caddy-data.tar.gz caddy_data
  add_staged_volume caddy-config.tar.gz caddy_config
fi

if [ "${2:-}" != "--confirm" ] && [ "${RESTORE_CONFIRM:-}" != "$RESTORE_ID" ]; then
  fail "staging succeeded; rerun with --confirm to perform the cutover"
fi

mapfile -t app_services < <(deployment_app_services)
running_services=("${app_services[@]}")

echo "Stopping application services for atomic database/volume cutover..."
if [ "${#running_services[@]}" -gt 0 ]; then
  "${COMPOSE[@]}" stop -t 60 "${running_services[@]}" >/dev/null 2>&1 || true
  app_stopped=true
fi
cutover_started=true

for index in "${!stable_volumes[@]}"; do
  docker volume create "${rollback_volumes[$index]}" >/dev/null
  clear_and_copy_volume "${stable_volumes[$index]}" "${rollback_volumes[$index]}"
done

"${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  >/dev/null
"${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$ROLLBACK_DB\";" \
  >/dev/null
old_database_renamed=true
"${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "ALTER DATABASE \"$STAGING_DB\" RENAME TO \"$POSTGRES_DB\";" \
  >/dev/null
database_swapped=true
old_database_renamed=false
stage_db_exists=false

for index in "${!stable_volumes[@]}"; do
  volume_cutover_count=$((index + 1))
  clear_and_copy_volume "${stage_volumes[$index]}" "${stable_volumes[$index]}"
done

if [ "$remote_media_staged" = true ]; then
  "$RESTORE_REMOTE_MEDIA_HOOK" cutover "$EXTRACTED_DIR/media.tar.gz" "$RESTORE_ID"
fi

restart_application

echo "Waiting for restored backend readiness..."
backend_healthy=false
for _ in {1..60}; do
  backend_id="$("${COMPOSE[@]}" ps -q backend)"
  if [ -n "$backend_id" ] &&
    [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$backend_id")" = healthy ]; then
    backend_healthy=true
    break
  fi
  sleep 2
done
[ "$backend_healthy" = true ] || fail "restored backend did not become healthy within 120 seconds"

cutover_complete=true
rollback_state="$RESTORE_ROOT/restore-rollback-${RESTORE_ID}.json"
POSTGRES_DB="$POSTGRES_DB" \
ROLLBACK_DB="$ROLLBACK_DB" \
RESTORE_ID="$RESTORE_ID" \
STABLE_VOLUMES="$(IFS=:; echo "${stable_volumes[*]}")" \
ROLLBACK_VOLUMES="$(IFS=:; echo "${rollback_volumes[*]}")" \
REMOTE_MEDIA_HOOK="${RESTORE_REMOTE_MEDIA_HOOK:-}" \
python3 - "$rollback_state" <<'PY'
import json
import os
import sys

state = {
    "format_version": 1,
    "restore_id": os.environ["RESTORE_ID"],
    "current_database": os.environ["POSTGRES_DB"],
    "rollback_database": os.environ["ROLLBACK_DB"],
    "stable_volumes": [v for v in os.environ["STABLE_VOLUMES"].split(":") if v],
    "rollback_volumes": [v for v in os.environ["ROLLBACK_VOLUMES"].split(":") if v],
    "remote_media_hook": os.environ["REMOTE_MEDIA_HOOK"],
}
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(state, output, indent=2, sort_keys=True)
    output.write("\n")
PY
chmod 600 "$rollback_state"

echo "Restore complete. Preserved rollback database: $ROLLBACK_DB"
echo "Rollback state: $rollback_state"
echo "After the acceptance window, remove preserved rollback data per the documented procedure."

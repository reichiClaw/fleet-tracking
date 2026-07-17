#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

if [ "$#" -ne 2 ] || [ "$2" != "--confirm" ]; then
  echo "Usage: $0 <restore-rollback-state.json> --confirm" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment
init_compose_command

fail() {
  echo "Restore rollback failed: $*" >&2
  exit 1
}

STATE_FILE="$1"
[ -f "$STATE_FILE" ] || fail "state file not found: $STATE_FILE"
mode="$(stat -c '%a' "$STATE_FILE")"
(( (8#$mode & 8#077) == 0 )) || fail "state file must have owner-only permissions"

mapfile -t state < <(
  python3 - "$STATE_FILE" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    state = json.load(source)
if state.get("format_version") != 1:
    raise SystemExit("unsupported rollback state format")
identifier = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
volume = re.compile(r"^[A-Za-z0-9_.-]+$")
current = state["current_database"]
rollback = state["rollback_database"]
stable = state["stable_volumes"]
preserved = state["rollback_volumes"]
if not identifier.fullmatch(current) or not identifier.fullmatch(rollback):
    raise SystemExit("unsafe database name in state file")
if len(stable) != len(preserved):
    raise SystemExit("volume lists do not match")
if any(not volume.fullmatch(item) for item in stable + preserved):
    raise SystemExit("unsafe volume name in state file")
print(current)
print(rollback)
print(state["restore_id"])
print(":".join(stable))
print(":".join(preserved))
PY
)

CURRENT_DB="${state[0]}"
ROLLBACK_DB="${state[1]}"
RESTORE_ID="${state[2]}"
IFS=: read -r -a stable_volumes <<<"${state[3]}"
IFS=: read -r -a rollback_volumes <<<"${state[4]}"
POSTGRES_USER="${POSTGRES_USER:-fleet_tracking}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.24.1}"
FAILED_DB="${CURRENT_DB:0:32}_before_rollback_$(date -u +%Y%m%d%H%M%S)"
app_stopped=false
rollback_operation_started=false
rollback_operation_complete=false
volume_cutover_count=0
declare -a pre_rollback_volumes=()

restart_application() {
  if [ "$app_stopped" = true ]; then
    "${COMPOSE[@]}" up -d "${app_services[@]}" >/dev/null || true
    app_stopped=false
  fi
}

cleanup() {
  local exit_code=$?
  local index
  trap - EXIT INT TERM
  if [ "$rollback_operation_started" = true ] && [ "$rollback_operation_complete" = false ]; then
    for ((index = 0; index < volume_cutover_count; index++)); do
      clear_and_copy_volume "${pre_rollback_volumes[$index]}" "${stable_volumes[$index]}" || true
    done
  fi
  restart_application
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

clear_and_copy_volume() {
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
    --volume "$1:/source:ro" \
    --volume "$2:/destination" \
    "$BACKUP_HELPER_IMAGE" \
    sh -eu -c \
    'find /destination -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +;
     tar -C /source -cf - . | tar -C /destination -xf -'
}

"${COMPOSE[@]}" up -d db >/dev/null
ready=false
for _ in {1..60}; do
  if "${COMPOSE[@]}" exec -T db pg_isready \
    --username "$POSTGRES_USER" \
    --dbname postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[ "$ready" = true ] || fail "PostgreSQL did not become ready"

exists="$("${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --tuples-only \
  --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$ROLLBACK_DB';")"
[[ "$exists" =~ 1 ]] || fail "preserved rollback database no longer exists: $ROLLBACK_DB"

for index in "${!rollback_volumes[@]}"; do
  docker volume inspect "${rollback_volumes[$index]}" >/dev/null 2>&1 ||
    fail "preserved rollback volume is missing: ${rollback_volumes[$index]}"
done

mapfile -t app_services < <(deployment_app_services)
if [ "${#app_services[@]}" -gt 0 ]; then
  "${COMPOSE[@]}" stop -t 60 "${app_services[@]}" >/dev/null 2>&1 || true
  app_stopped=true
fi

for index in "${!stable_volumes[@]}"; do
  pre_volume="${stable_volumes[$index]}_before_rollback_$(date -u +%Y%m%d%H%M%S)"
  docker volume create "$pre_volume" >/dev/null
  clear_and_copy_volume "${stable_volumes[$index]}" "$pre_volume"
  pre_rollback_volumes+=("$pre_volume")
done
rollback_operation_started=true

for index in "${!stable_volumes[@]}"; do
  volume_cutover_count=$((index + 1))
  clear_and_copy_volume "${rollback_volumes[$index]}" "${stable_volumes[$index]}"
done
if [ -n "${RESTORE_REMOTE_MEDIA_HOOK:-}" ]; then
  [ -x "$RESTORE_REMOTE_MEDIA_HOOK" ] ||
    fail "RESTORE_REMOTE_MEDIA_HOOK must be executable"
  "$RESTORE_REMOTE_MEDIA_HOOK" rollback "" "$RESTORE_ID"
fi

"${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$CURRENT_DB' AND pid <> pg_backend_pid();" \
  --command "ALTER DATABASE \"$CURRENT_DB\" RENAME TO \"$FAILED_DB\";" \
  >/dev/null
if ! "${COMPOSE[@]}" exec -T db psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "ALTER DATABASE \"$ROLLBACK_DB\" RENAME TO \"$CURRENT_DB\";" \
  >/dev/null; then
  "${COMPOSE[@]}" exec -T db psql \
    --username "$POSTGRES_USER" \
    --dbname postgres \
    --command "ALTER DATABASE \"$FAILED_DB\" RENAME TO \"$CURRENT_DB\";" \
    >/dev/null || true
  fail "database rollback rename failed; current database name was restored"
fi

rollback_operation_complete=true
restart_application

echo "Rollback complete. The replaced database is preserved as $FAILED_DB."
echo "Pre-rollback volumes are preserved: ${pre_rollback_volumes[*]:-none}"

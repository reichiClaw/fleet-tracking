#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
STATUS_FILE="$BACKUP_DIR/last-backup-status.json"

command -v python3 >/dev/null 2>&1 || {
  echo "Backup status failed: python3 is required" >&2
  exit 2
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "Backup status failed: sha256sum is required" >&2
  exit 2
}
[ -f "$STATUS_FILE" ] || {
  echo "Backup status CRITICAL: no successful backup status at $STATUS_FILE" >&2
  exit 2
}

readarray -t status_values < <(
  python3 - "$STATUS_FILE" "$BACKUP_MAX_AGE_HOURS" <<'PY'
from datetime import datetime, timezone
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    status = json.load(source)
created = datetime.fromisoformat(status["created_at_utc"].replace("Z", "+00:00"))
age_seconds = int((datetime.now(timezone.utc) - created).total_seconds())
max_age_seconds = int(float(sys.argv[2]) * 3600)
print(status["bundle"])
print(status["sha256"])
print(age_seconds)
print(max_age_seconds)
print(status.get("offsite_status", "unknown"))
print(status.get("backup_id", "unknown"))
PY
)

bundle="${status_values[0]}"
expected_checksum="${status_values[1]}"
age_seconds="${status_values[2]}"
max_age_seconds="${status_values[3]}"
offsite_status="${status_values[4]}"
backup_id="${status_values[5]}"

[ -f "$bundle" ] || {
  echo "Backup status CRITICAL: recorded bundle is missing: $bundle" >&2
  exit 2
}
actual_checksum="$(sha256sum "$bundle" | awk '{print $1}')"
[ "$actual_checksum" = "$expected_checksum" ] || {
  echo "Backup status CRITICAL: ciphertext checksum mismatch: $bundle" >&2
  exit 2
}

if [ -f "$bundle.sha256" ]; then
  (cd "$(dirname "$bundle")" && sha256sum --check --status "$(basename "$bundle").sha256") || {
    echo "Backup status CRITICAL: sidecar checksum failed: $bundle.sha256" >&2
    exit 2
  }
else
  echo "Backup status CRITICAL: missing sidecar checksum: $bundle.sha256" >&2
  exit 2
fi

if [ "$age_seconds" -gt "$max_age_seconds" ]; then
  echo "Backup status CRITICAL: $backup_id is ${age_seconds}s old (limit ${max_age_seconds}s)" >&2
  exit 2
fi
if [ -n "${BACKUP_OFFSITE_HOOK:-}" ] && [ "$offsite_status" != ok ]; then
  echo "Backup status CRITICAL: latest offsite copy status is $offsite_status" >&2
  exit 2
fi

echo "Backup status OK: id=$backup_id age_seconds=$age_seconds offsite=$offsite_status bundle=$bundle"

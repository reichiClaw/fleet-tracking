#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment

failures=0
critical() {
  echo "CRITICAL: $*" >&2
  failures=$((failures + 1))
}

for command_name in curl openssl df; do
  command -v "$command_name" >/dev/null 2>&1 || critical "missing monitoring command: $command_name"
done
[ "$failures" -eq 0 ] || exit 2

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
TLS_DOMAIN="${TLS_DOMAIN:-}"
CERT_MIN_VALID_DAYS="${CERT_MIN_VALID_DAYS:-14}"
DISK_USAGE_CRITICAL_PERCENT="${DISK_USAGE_CRITICAL_PERCENT:-85}"
DISK_PATHS="${DISK_PATHS:-/:${BACKUP_DIR:-$ROOT_DIR/backups}}"

[[ "$PUBLIC_BASE_URL" == https://* ]] || critical "PUBLIC_BASE_URL must use HTTPS"
if ! curl --fail --silent --show-error \
  --proto '=https' \
  --tlsv1.2 \
  --max-time 15 \
  "$PUBLIC_BASE_URL/api/health/ready/" >/dev/null; then
  critical "external HTTPS readiness probe failed"
else
  echo "HTTPS readiness OK: $PUBLIC_BASE_URL/api/health/ready/"
fi

if [ -z "$TLS_DOMAIN" ]; then
  critical "TLS_DOMAIN is empty"
elif ! openssl s_client \
  -connect "$TLS_DOMAIN:443" \
  -servername "$TLS_DOMAIN" \
  </dev/null 2>/dev/null |
  openssl x509 -checkend "$((CERT_MIN_VALID_DAYS * 86400))" -noout >/dev/null; then
  critical "certificate expires within $CERT_MIN_VALID_DAYS days or could not be validated"
else
  echo "Certificate validity OK: more than $CERT_MIN_VALID_DAYS days remain"
fi

if ! ENV_FILE="$ENV_FILE" "$ROOT_DIR/scripts/backup-status.sh"; then
  failures=$((failures + 1))
fi

IFS=: read -r -a disk_paths <<<"$DISK_PATHS"
for path in "${disk_paths[@]}"; do
  [ -e "$path" ] || {
    critical "disk path does not exist: $path"
    continue
  }
  usage="$(df -P "$path" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if [ -z "$usage" ] || [ "$usage" -ge "$DISK_USAGE_CRITICAL_PERCENT" ]; then
    critical "disk usage for $path is ${usage:-unknown}% (limit $DISK_USAGE_CRITICAL_PERCENT%)"
  else
    echo "Disk usage OK: $path is $usage%"
  fi
done

[ "$failures" -eq 0 ] || exit 2
echo "Deployment monitoring checks OK."

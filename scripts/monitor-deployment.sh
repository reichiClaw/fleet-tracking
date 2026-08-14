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
TLS_MODE="${TLS_MODE:-acme}"
CERT_MIN_VALID_DAYS="${CERT_MIN_VALID_DAYS:-14}"
DISK_USAGE_CRITICAL_PERCENT="${DISK_USAGE_CRITICAL_PERCENT:-85}"
DISK_PATHS="${DISK_PATHS:-/:${BACKUP_DIR:-$ROOT_DIR/backups}}"
init_compose_command

[[ "$PUBLIC_BASE_URL" == https://* ]] || critical "PUBLIC_BASE_URL must use HTTPS"

curl_opts=(
  --fail
  --silent
  --show-error
  --proto '=https'
  --tlsv1.2
  --max-time 15
)
ca_tmp=""
if [ "$TLS_MODE" = internal ]; then
  ca_tmp="$(mktemp)"
  if "${COMPOSE[@]}" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$ca_tmp" \
    2>/dev/null && [ -s "$ca_tmp" ]; then
    curl_opts+=(--cacert "$ca_tmp")
  else
    critical "TLS_MODE=internal but the Caddy local root CA could not be read"
  fi
fi

curl_err="$(mktemp)"
if ! curl "${curl_opts[@]}" "$PUBLIC_BASE_URL/api/health/ready/" >/dev/null 2>"$curl_err"; then
  critical "external HTTPS readiness probe failed"
  if [ -s "$curl_err" ]; then
    cat "$curl_err" >&2
  fi
  if grep -qiE 'certificate|SSL|TLS|issuer|self.signed' "$curl_err"; then
    if [ "$TLS_MODE" = internal ]; then
      echo "TLS_MODE=internal uses Caddy's local CA. Run 'make prod-ca' and trust that root certificate." >&2
    else
      echo "The presented certificate is untrusted. Run 'make prod-tls-status' and check DNS plus ports 80/443." >&2
    fi
  fi
else
  echo "HTTPS readiness OK: $PUBLIC_BASE_URL/api/health/ready/"
fi
rm -f "$curl_err"

if [ -z "$TLS_DOMAIN" ]; then
  critical "TLS_DOMAIN is empty"
else
  cert_tmp="$(mktemp)"
  if openssl s_client \
    -connect "$TLS_DOMAIN:443" \
    -servername "$TLS_DOMAIN" \
    </dev/null 2>/dev/null |
    openssl x509 -out "$cert_tmp" 2>/dev/null \
    && [ -s "$cert_tmp" ]; then
    issuer="$(openssl x509 -in "$cert_tmp" -noout -issuer 2>/dev/null || true)"
    if [ "$TLS_MODE" = acme ] && printf '%s\n' "$issuer" | grep -qiE 'Caddy Local Authority|DO NOT TRUST'; then
      critical "Caddy is serving its internal CA instead of a public certificate; ACME issuance failed"
    elif ! openssl x509 -in "$cert_tmp" -checkend "$((CERT_MIN_VALID_DAYS * 86400))" -noout >/dev/null; then
      critical "certificate expires within $CERT_MIN_VALID_DAYS days or could not be validated"
    else
      echo "Certificate validity OK: more than $CERT_MIN_VALID_DAYS days remain"
    fi
  else
    critical "could not download the TLS certificate for $TLS_DOMAIN:443"
  fi
  rm -f "$cert_tmp"
fi
if [ -n "$ca_tmp" ]; then
  rm -f "$ca_tmp"
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

#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment
init_compose_command

TLS_DOMAIN="${TLS_DOMAIN:-}"
TLS_MODE="${TLS_MODE:-acme}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"

echo "TLS_MODE=$TLS_MODE"
echo "TLS_DOMAIN=$TLS_DOMAIN"
echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
echo

if [ -z "$TLS_DOMAIN" ]; then
  echo "TLS_DOMAIN is empty." >&2
  exit 2
fi

echo "Recent Caddy certificate/ACME log lines:"
"${COMPOSE[@]}" logs --no-log-prefix --tail=200 caddy 2>/dev/null |
  grep -Ei 'certificate|acme|tls|issuer|obtain|challenge|error' |
  tail -n 40 || echo "(no matching Caddy log lines)"
echo

echo "Presented certificate:"
cert_text="$(
  openssl s_client \
    -connect "$TLS_DOMAIN:443" \
    -servername "$TLS_DOMAIN" \
    </dev/null 2>/dev/null |
    openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null ||
    true
)"
if [ -z "$cert_text" ]; then
  echo "Could not read a certificate from $TLS_DOMAIN:443."
  echo "If this is the first start, wait for ACME to finish. Otherwise check DNS and that ports 80/443 reach Caddy."
  exit 2
fi
printf '%s\n' "$cert_text"
echo

if printf '%s\n' "$cert_text" | grep -qiE 'Caddy Local Authority|DO NOT TRUST'; then
  if [ "$TLS_MODE" = internal ]; then
    echo "Caddy is using its local CA, which matches TLS_MODE=internal."
    echo "Run 'make prod-ca' and trust that root certificate on each client."
  else
    echo "Caddy is serving its local/internal CA, so browsers will show a certificate error." >&2
    echo "Let's Encrypt issuance did not complete. Check public DNS, inbound 80/443, and the log lines above." >&2
    echo "For a LAN-only Proxmox hostname (.local/.lan/.internal), set TLS_MODE=internal." >&2
    exit 2
  fi
else
  echo "Certificate issuer looks like a public CA."
fi

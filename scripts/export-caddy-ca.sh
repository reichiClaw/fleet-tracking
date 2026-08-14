#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/compose.sh
. "$ROOT_DIR/scripts/lib/compose.sh"
load_deployment_environment
init_compose_command

if [ "${TLS_MODE:-acme}" != internal ]; then
  echo "TLS_MODE is ${TLS_MODE:-acme}; the Caddy local CA is only used for TLS_MODE=internal." >&2
  exit 1
fi

output="${1:-$ROOT_DIR/caddy-local-root.crt}"
if [ -e "$output" ] && [ ! -f "$output" ]; then
  echo "Refusing to overwrite non-file path: $output" >&2
  exit 1
fi

"${COMPOSE[@]}" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$output"
if [ ! -s "$output" ]; then
  echo "Caddy local root CA was empty. Is the caddy service running?" >&2
  rm -f "$output"
  exit 1
fi
chmod 644 "$output"
echo "Wrote Caddy local root CA to $output"
echo "Install this certificate in the OS or browser trust store to clear certificate warnings."

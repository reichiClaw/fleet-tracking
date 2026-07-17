#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${ENV_FILE:-$ROOT_DIR/.env.production}"
TEMPLATE="$ROOT_DIR/.env.production.example"

[ -f "$TEMPLATE" ] || {
  echo "Missing template: $TEMPLATE" >&2
  exit 1
}
[ ! -e "$TARGET" ] || {
  echo "Refusing to overwrite existing file: $TARGET" >&2
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required to generate production secrets" >&2
  exit 1
}

install -m 600 "$TEMPLATE" "$TARGET"
secret_key="$(openssl rand -hex 48)"
database_password="$(openssl rand -hex 32)"

python3 - "$TARGET" "$secret_key" "$database_password" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
replacements = {
    "DJANGO_SECRET_KEY": sys.argv[2],
    "POSTGRES_PASSWORD": sys.argv[3],
    "DATABASE_URL": (
        f"postgres://fleet_tracking:{sys.argv[3]}@db:5432/fleet_tracking"
    ),
}
lines = []
for line in path.read_text().splitlines():
    key = line.split("=", 1)[0]
    if key in replacements:
        line = f"{key}={replacements[key]}"
    lines.append(line)
path.write_text("\n".join(lines) + "\n")
PY

chmod 600 "$TARGET"
echo "Created $TARGET with generated database and Django secrets."
echo "Fill the remaining blank domain, TLS, email, and backup recipient values."

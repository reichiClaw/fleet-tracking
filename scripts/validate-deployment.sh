#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mapfile -t shell_scripts < <(
  printf '%s\n' scripts/*.sh scripts/lib/*.sh
)
bash -n "${shell_scripts[@]}"
python3 -m py_compile scripts/validate-backup.py

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${shell_scripts[@]}"
else
  echo "shellcheck not installed; skipping lint (bash syntax was checked)."
fi

python3 - <<'PY'
from pathlib import Path
import re

workflow = Path(".github/workflows/ci.yml").read_text()
for action in re.findall(r"uses:\s*([^\s#]+)", workflow):
    if not re.search(r"@[0-9a-f]{40}$", action):
        raise SystemExit(f"CI action is not pinned to a full commit SHA: {action}")

for compose_file in (
    "docker-compose.yml",
    "docker-compose.prod.yml",
    "docker-compose.tls.yml",
):
    content = Path(compose_file).read_text()
    if re.search(r"^\s+env_file:", content, re.MULTILINE):
        raise SystemExit(f"{compose_file} must not use broad env_file injection")
    if "change-me" in content.lower():
        raise SystemExit(f"{compose_file} contains a runnable change-me value")

backend_command = Path("docker-compose.yml").read_text().split("  backend:", 1)[1].split(
    "  release:", 1
)[0]
if "manage.py migrate" in backend_command:
    raise SystemExit("backend runtime command must not run migrations")

settings = Path("backend/config/settings.py").read_text()
configured = set(
    re.findall(r'(?:env|env_bool|env_list|os\.getenv)\("([A-Z][A-Z0-9_]+)"', settings)
)
base_compose = Path("docker-compose.yml").read_text()
missing = sorted(name for name in configured if f"{name}:" not in base_compose)
if missing:
    raise SystemExit(
        "backend settings are not explicitly passed by Compose: " + ", ".join(missing)
    )
PY

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
ENV_FILE="$work_dir/production.env" ./scripts/init-production-env.sh >/dev/null
cat >>"$work_dir/production.env" <<'EOF'
DJANGO_ALLOWED_HOSTS=fleet.example.test
DJANGO_CSRF_TRUSTED_ORIGINS=https://fleet.example.test
PUBLIC_BASE_URL=https://fleet.example.test
TLS_DOMAIN=fleet.example.test
TLS_EMAIL=admin@example.test
AGE_RECIPIENT=age1ci-validation-recipient
BACKUP_DIR=/tmp/fleet-backups
DEFAULT_FROM_EMAIL=fleet@example.test
EOF
chmod 600 "$work_dir/production.env"
ENV_FILE="$work_dir/production.env" ./scripts/check-production-env.sh >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is unavailable; Compose/Caddy/Nginx runtime validation skipped."
  exit 0
fi

docker compose -f docker-compose.yml config --quiet
docker compose \
  --env-file "$work_dir/production.env" \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.tls.yml \
  config --format json >"$work_dir/production-compose.json"

python3 - "$work_dir/production-compose.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
services = config["services"]
if services["nginx"].get("ports"):
    raise SystemExit("production Nginx must not publish host ports")
published = {
    (str(port["published"]), int(port["target"]))
    for port in services["caddy"].get("ports", [])
}
if not {("80", 80), ("443", 443)}.issubset(published):
    raise SystemExit("production Caddy must publish ports 80 and 443")
for name, service in services.items():
    if "env_file" in service:
        raise SystemExit(f"{name} contains env_file after merge")
    if name != "release" and "manage.py migrate" in " ".join(service.get("command", [])):
        raise SystemExit(f"{name} unexpectedly runs migrations")
if "manage.py migrate" not in " ".join(services["release"]["command"]):
    raise SystemExit("release service does not run migrations")
if services["db"]["networks"].keys() != {"db"}:
    raise SystemExit("database must attach only to the db network")
if set(services["caddy"]["networks"]) != {"edge"}:
    raise SystemExit("Caddy must attach only to the edge network")
PY

docker run --rm \
  --env TLS_DOMAIN=fleet.example.test \
  --env TLS_EMAIL=admin@example.test \
  --env TLS_HSTS=max-age=31536000 \
  --volume "$ROOT_DIR/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.4-alpine \
  caddy validate --config /etc/caddy/Caddyfile >/dev/null

docker run --rm \
  --add-host backend:127.0.0.1 \
  --add-host frontend:127.0.0.1 \
  --volume "$ROOT_DIR/deploy/nginx/fleet-tracking.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.30.2-alpine3.23 \
  nginx -t >/dev/null

docker run --rm \
  --add-host backend:127.0.0.1 \
  --add-host frontend:127.0.0.1 \
  --env EDGE_SUBNET=172.30.0.0/24 \
  --env NGINX_ENVSUBST_FILTER='^EDGE_SUBNET$' \
  --volume "$ROOT_DIR/deploy/nginx/fleet-tracking-tls.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  nginx:1.30.2-alpine3.23 \
  nginx -t >/dev/null

echo "Deployment static validation passed."

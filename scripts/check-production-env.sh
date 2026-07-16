#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${1:-$ROOT_DIR/.env.production}}"

fail() {
  echo "Production environment check failed: $*" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE (run 'make prod-init-env')"
[ ! -L "$ENV_FILE" ] || fail "$ENV_FILE must not be a symbolic link"

mode="$(stat -c '%a' "$ENV_FILE")"
owner="$(stat -c '%u' "$ENV_FILE")"
if (( (8#$mode & 8#077) != 0 )); then
  fail "$ENV_FILE mode is $mode; remove all group/other access with chmod 600"
fi
if [ "$owner" != "$(id -u)" ] && [ "$owner" != "0" ]; then
  fail "$ENV_FILE must be owned by the deployment user or root"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

required=(
  COMPOSE_PROJECT_NAME
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  DJANGO_SECRET_KEY
  DJANGO_ALLOWED_HOSTS
  DJANGO_CSRF_TRUSTED_ORIGINS
  PUBLIC_BASE_URL
  TLS_DOMAIN
  TLS_EMAIL
  BACKUP_DIR
  BACKUP_ENCRYPTION
)

for name in "${required[@]}"; do
  [ -n "${!name:-}" ] || fail "$name is empty"
done

[ "${ENVIRONMENT:-}" = production ] || fail "ENVIRONMENT must be production"
[ "${#DJANGO_SECRET_KEY}" -ge 50 ] || fail "DJANGO_SECRET_KEY must contain at least 50 characters"
[ "${#POSTGRES_PASSWORD}" -ge 24 ] || fail "POSTGRES_PASSWORD must contain at least 24 characters"
[[ "$DJANGO_ALLOWED_HOSTS" != *"*"* ]] || fail "DJANGO_ALLOWED_HOSTS must not contain a wildcard"
[[ "$DATABASE_URL" == postgres://* ]] || fail "DATABASE_URL must be a PostgreSQL URL"
if ! DATABASE_URL="$DATABASE_URL" \
  POSTGRES_USER="$POSTGRES_USER" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  POSTGRES_DB="$POSTGRES_DB" \
  python3 - <<'PY'
import os
from urllib.parse import unquote, urlsplit

url = urlsplit(os.environ["DATABASE_URL"])
valid = (
    url.scheme in {"postgres", "postgresql"}
    and unquote(url.username or "") == os.environ["POSTGRES_USER"]
    and unquote(url.password or "") == os.environ["POSTGRES_PASSWORD"]
    and url.hostname == "db"
    and (url.port or 5432) == 5432
    and url.path == f"/{os.environ['POSTGRES_DB']}"
)
raise SystemExit(0 if valid else 1)
PY
then
  fail "DATABASE_URL must exactly match POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB on db:5432"
fi
[[ "$PUBLIC_BASE_URL" == "https://$TLS_DOMAIN" || "$PUBLIC_BASE_URL" == "https://$TLS_DOMAIN/" ]] ||
  fail "PUBLIC_BASE_URL must be https://TLS_DOMAIN"
[[ ",$DJANGO_ALLOWED_HOSTS," == *",$TLS_DOMAIN,"* ]] ||
  fail "DJANGO_ALLOWED_HOSTS must include TLS_DOMAIN"
[[ ",$DJANGO_CSRF_TRUSTED_ORIGINS," == *",https://$TLS_DOMAIN,"* ]] ||
  fail "DJANGO_CSRF_TRUSTED_ORIGINS must include https://TLS_DOMAIN"
[[ "$TLS_EMAIL" == *@* ]] || fail "TLS_EMAIL must be an email address"
[[ "$BACKUP_DIR" == /* ]] || fail "BACKUP_DIR must be an absolute host path in production"
[ -z "${DJANGO_SUPERUSER_PASSWORD:-}" ] ||
  fail "persistent DJANGO_SUPERUSER_PASSWORD is forbidden"

case "$BACKUP_ENCRYPTION" in
  age)
    [ -n "${AGE_RECIPIENT:-}" ] || fail "AGE_RECIPIENT is required for age encryption"
    [[ "$AGE_RECIPIENT" == age1* || "$AGE_RECIPIENT" == age-plugin-* ]] ||
      fail "AGE_RECIPIENT does not look like an age recipient"
    ;;
  gpg)
    [ -n "${GPG_RECIPIENT:-}" ] || fail "GPG_RECIPIENT is required for gpg encryption"
    ;;
  *)
    fail "BACKUP_ENCRYPTION must be age or gpg"
    ;;
esac

for value in "$DJANGO_SECRET_KEY" "$POSTGRES_PASSWORD" "$DATABASE_URL"; do
  lower="${value,,}"
  [[ "$lower" != *"change-me"* && "$lower" != *"dev-only"* && "$lower" != *"example"* ]] ||
    fail "a required secret still contains a sample/development marker"
done

echo "Production environment is complete and has owner-only permissions."

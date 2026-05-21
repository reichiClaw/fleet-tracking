#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <database-dump-file> <media-tar-gz-file>"
  exit 1
fi

DB_DUMP="$1"
MEDIA_ARCHIVE="$2"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fleet-tracking}"
POSTGRES_USER="${POSTGRES_USER:-fleet_tracking}"
POSTGRES_DB="${POSTGRES_DB:-fleet_tracking}"

if [ ! -f "$DB_DUMP" ]; then
  echo "Database dump not found: $DB_DUMP"
  exit 1
fi

if [ ! -f "$MEDIA_ARCHIVE" ]; then
  echo "Media archive not found: $MEDIA_ARCHIVE"
  exit 1
fi

MEDIA_DIR="$(cd "$(dirname "$MEDIA_ARCHIVE")" && pwd)"
MEDIA_FILE="$(basename "$MEDIA_ARCHIVE")"

echo "Stopping application..."
docker compose down

echo "Starting database..."
docker compose up -d db

echo "Restoring database..."
docker compose exec -T db dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" || true
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  < "$DB_DUMP"

echo "Restoring media volume..."
docker volume rm "${COMPOSE_PROJECT_NAME}_media_data" || true
docker volume create "${COMPOSE_PROJECT_NAME}_media_data"
docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_media_data:/media" \
  -v "${MEDIA_DIR}:/restore:ro" \
  alpine tar xzf "/restore/${MEDIA_FILE}" -C /media

echo "Restarting application..."
docker compose up -d

echo "Restore complete."

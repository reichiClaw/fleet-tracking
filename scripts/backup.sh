#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fleet-tracking}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "Creating PostgreSQL backup..."
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-fleet_tracking}" \
  -d "${POSTGRES_DB:-fleet_tracking}" \
  --format=custom \
  > "${BACKUP_DIR}/fleet_tracking_${TIMESTAMP}.dump"

echo "Creating media backup..."
docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_media_data:/media:ro" \
  -v "$PWD/${BACKUP_DIR}:/backups" \
  alpine tar czf "/backups/media_${TIMESTAMP}.tar.gz" -C /media .

echo "Backup complete:"
echo "  ${BACKUP_DIR}/fleet_tracking_${TIMESTAMP}.dump"
echo "  ${BACKUP_DIR}/media_${TIMESTAMP}.tar.gz"

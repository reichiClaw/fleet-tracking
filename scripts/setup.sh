#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALL_SYSTEM_PACKAGES=false
RUN_TESTS=true
START_STACK=false
CREATE_SUPERUSER=false

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [options]

Prepare and optionally deploy the Fleet Tracking app.

Options:
  --install-system-packages  Install python3-venv, Docker, and Compose via apt.
  --skip-tests               Install dependencies without running tests/build checks.
  --deploy                   Build and start the Docker Compose stack after checks.
  --create-superuser         Run Django createsuperuser in the backend container after deploy.
  -h, --help                 Show this help.

Examples:
  ./scripts/setup.sh
  ./scripts/setup.sh --install-system-packages --deploy --create-superuser
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-system-packages) INSTALL_SYSTEM_PACKAGES=true ;;
    --skip-tests) RUN_TESTS=false ;;
    --deploy) START_STACK=true ;;
    --create-superuser) CREATE_SUPERUSER=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

if [ "$INSTALL_SYSTEM_PACKAGES" = true ]; then
  echo "Installing system packages..."
  sudo apt-get update
  sudo apt-get install -y python3-venv docker.io docker-compose-v2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command python3
require_command npm
require_command docker

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "Python venv support is missing. Rerun with --install-system-packages or install python3-venv." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "Review .env before production deployment, especially secrets, hosts, HTTPS, and passwords."
fi

echo "Preparing backend virtual environment..."
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install -r backend/requirements.txt

echo "Installing frontend dependencies..."
npm ci --prefix frontend

if [ "$RUN_TESTS" = true ]; then
  echo "Running backend checks..."
  (cd backend && .venv/bin/python manage.py test)
  (cd backend && .venv/bin/python manage.py check)
  (cd backend && .venv/bin/python manage.py makemigrations --check --dry-run)

  echo "Running frontend checks..."
  npm test --prefix frontend
  npm run build --prefix frontend
  npm audit --prefix frontend --audit-level=moderate
fi

echo "Validating Docker Compose configuration..."
docker compose config >/dev/null

if [ "$START_STACK" = true ]; then
  echo "Building and starting Docker Compose stack..."
  docker compose up -d --build
  docker compose ps

  if [ "$CREATE_SUPERUSER" = true ]; then
    echo "Creating Django superuser..."
    docker compose exec backend python manage.py createsuperuser
  fi
fi

echo "Setup complete."

#!/usr/bin/env bash

# Shared Compose/environment selection for operational scripts.

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

load_deployment_environment() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

init_compose_command() {
  COMPOSE=(docker compose)
  if [ -f "$ENV_FILE" ]; then
    COMPOSE+=(--env-file "$ENV_FILE")
  fi

  if [ -n "${COMPOSE_FILES:-}" ]; then
    local compose_file
    local -a selected_files
    IFS=: read -r -a selected_files <<<"$COMPOSE_FILES"
    for compose_file in "${selected_files[@]}"; do
      COMPOSE+=(-f "$compose_file")
    done
  elif [ "${DEPLOYMENT_MODE:-${ENVIRONMENT:-development}}" = production ]; then
    COMPOSE+=(
      -f "$ROOT_DIR/docker-compose.yml"
      -f "$ROOT_DIR/docker-compose.prod.yml"
      -f "$ROOT_DIR/docker-compose.tls.yml"
    )
  else
    COMPOSE+=(-f "$ROOT_DIR/docker-compose.yml")
  fi
}

is_production_deployment() {
  [ "${DEPLOYMENT_MODE:-${ENVIRONMENT:-development}}" = production ]
}

deployment_app_services() {
  if is_production_deployment; then
    printf '%s\n' backend frontend nginx caddy
  else
    printf '%s\n' backend frontend nginx
  fi
}

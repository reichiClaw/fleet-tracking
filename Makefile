.PHONY: help compose-config validate dev-build dev-release up down logs \
	prod-init-env prod-check prod-config prod-build prod-release prod-up \
	prod-deploy prod-down prod-logs backup backup-prod backup-status \
	restore restore-prod rollback-prod monitor-prod cleanup-media-prod python-lock

DEV_ENV_ARG = $(if $(wildcard .env),--env-file .env,)
DEV_COMPOSE = docker compose $(DEV_ENV_ARG) -f docker-compose.yml
PROD_ENV ?= .env.production
PROD_COMPOSE = docker compose --env-file $(PROD_ENV) -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tls.yml

help:
	@echo "Fleet Tracking helper targets"
	@echo "  make up                  Build/release/start loopback-only development"
	@echo "  make down                Stop development stack"
	@echo "  make prod-init-env       Create owner-only .env.production with secrets"
	@echo "  make prod-config         Fail-closed production configuration validation"
	@echo "  make prod-release        Run production migrations and collectstatic once"
	@echo "  make prod-up             Start mandatory-TLS production stack"
	@echo "  make prod-deploy         Build, release, and start production"
	@echo "  make backup-prod         Create encrypted production backup"
	@echo "  make backup-status       Check latest backup age and integrity"
	@echo "  make restore-prod BUNDLE=... CONFIRM=YES"
	@echo "  make rollback-prod STATE=... CONFIRM=YES"
	@echo "  make monitor-prod        Check HTTPS, certificate, backup, and disks"
	@echo "  make cleanup-media-prod  Delete expired unattached media uploads"
	@echo "  make validate            Run deployment static validation"

compose-config:
	$(DEV_COMPOSE) config

validate:
	./scripts/validate-deployment.sh

dev-build:
	$(DEV_COMPOSE) build

dev-release:
	$(DEV_COMPOSE) up -d db
	$(DEV_COMPOSE) run --rm release

up: dev-build dev-release
	$(DEV_COMPOSE) up -d

down:
	$(DEV_COMPOSE) down

logs:
	$(DEV_COMPOSE) logs -f

prod-init-env:
	ENV_FILE="$(PROD_ENV)" ./scripts/init-production-env.sh

prod-check:
	ENV_FILE="$(PROD_ENV)" ./scripts/check-production-env.sh

prod-config: prod-check
	$(PROD_COMPOSE) config --quiet

prod-build: prod-check
	$(PROD_COMPOSE) build

prod-release: prod-check
	$(PROD_COMPOSE) up -d db
	$(PROD_COMPOSE) run --rm release

prod-up: prod-check
	$(PROD_COMPOSE) up -d

prod-deploy: prod-build prod-release prod-up

prod-down: prod-check
	$(PROD_COMPOSE) down

prod-logs: prod-check
	$(PROD_COMPOSE) logs -f

backup:
	ENV_FILE="$(if $(wildcard .env),.env,/dev/null)" ./scripts/backup.sh

backup-prod: prod-check
	ENV_FILE="$(PROD_ENV)" DEPLOYMENT_MODE=production ./scripts/backup.sh

backup-status:
	ENV_FILE="$(PROD_ENV)" DEPLOYMENT_MODE=production ./scripts/backup-status.sh

restore:
	@test -n "$(BUNDLE)" || (echo "BUNDLE=<encrypted-bundle> is required" && exit 1)
	@test "$(CONFIRM)" = "YES" || (echo "Set CONFIRM=YES after reviewing the restore runbook" && exit 1)
	ENV_FILE="$(if $(wildcard .env),.env,/dev/null)" ./scripts/restore.sh "$(BUNDLE)" --confirm

restore-prod: prod-check
	@test -n "$(BUNDLE)" || (echo "BUNDLE=<encrypted-bundle> is required" && exit 1)
	@test "$(CONFIRM)" = "YES" || (echo "Set CONFIRM=YES after reviewing the restore runbook" && exit 1)
	ENV_FILE="$(PROD_ENV)" DEPLOYMENT_MODE=production ./scripts/restore.sh "$(BUNDLE)" --confirm

rollback-prod: prod-check
	@test -n "$(STATE)" || (echo "STATE=<restore-rollback-state.json> is required" && exit 1)
	@test "$(CONFIRM)" = "YES" || (echo "Set CONFIRM=YES after reviewing the rollback runbook" && exit 1)
	ENV_FILE="$(PROD_ENV)" DEPLOYMENT_MODE=production ./scripts/rollback-restore.sh "$(STATE)" --confirm

monitor-prod: prod-check
	ENV_FILE="$(PROD_ENV)" DEPLOYMENT_MODE=production ./scripts/monitor-deployment.sh

cleanup-media-prod: prod-check
	$(PROD_COMPOSE) run --rm --no-deps backend python manage.py cleanup_staged_media

python-lock:
	./scripts/lock-python-dependencies.sh

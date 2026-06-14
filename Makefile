.PHONY: help compose-config up up-tls down down-tls logs backup restore

TLS_COMPOSE = docker compose -f docker-compose.yml -f docker-compose.tls.yml

help:
	@echo "Fleet Tracking helper targets"
	@echo "  make compose-config   Validate Docker Compose configuration"
	@echo "  make up               Start Docker Compose stack (HTTP)"
	@echo "  make up-tls           Start stack with automatic HTTPS (Caddy)"
	@echo "  make down             Stop Docker Compose stack"
	@echo "  make down-tls         Stop the HTTPS (Caddy) stack"
	@echo "  make logs             Follow Docker Compose logs"
	@echo "  make backup           Run backup script"
	@echo "  make restore DB=... MEDIA=...  Run restore script"

compose-config:
	docker compose config

up:
	docker compose up -d --build

up-tls:
	$(TLS_COMPOSE) up -d --build

down:
	docker compose down

down-tls:
	$(TLS_COMPOSE) down

logs:
	docker compose logs -f

backup:
	./scripts/backup.sh

restore:
	@test -n "$(DB)" || (echo "DB=<dump-file> is required" && exit 1)
	@test -n "$(MEDIA)" || (echo "MEDIA=<media-archive> is required" && exit 1)
	./scripts/restore.sh "$(DB)" "$(MEDIA)"

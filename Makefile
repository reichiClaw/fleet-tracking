.PHONY: help compose-config up down logs backup restore

help:
	@echo "Fleet Tracking helper targets"
	@echo "  make compose-config   Validate Docker Compose configuration"
	@echo "  make up               Start Docker Compose stack"
	@echo "  make down             Stop Docker Compose stack"
	@echo "  make logs             Follow Docker Compose logs"
	@echo "  make backup           Run backup script"
	@echo "  make restore DB=... MEDIA=...  Run restore script"

compose-config:
	docker compose config

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

backup:
	./scripts/backup.sh

restore:
	@test -n "$(DB)" || (echo "DB=<dump-file> is required" && exit 1)
	@test -n "$(MEDIA)" || (echo "MEDIA=<media-archive> is required" && exit 1)
	./scripts/restore.sh "$(DB)" "$(MEDIA)"

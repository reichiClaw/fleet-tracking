# Agent Task: DevOps and Docker

## Goal

Make the application runnable and operable through Docker Compose.

## Read first

- `docs/deployment.md`
- `.env.example`
- `docker-compose.yml`

## Scope

- Verify and refine `docker-compose.yml`.
- Add backend Dockerfile if missing.
- Add frontend Dockerfile if missing.
- Add Nginx config.
- Add health checks.
- Add backup and restore scripts.
- Document common commands.

## Requirements

- PostgreSQL must not be exposed publicly.
- Database and media must be persistent.
- Secrets must come from environment variables.
- Production deployment should work on a Proxmox-hosted Ubuntu VM.

## Acceptance criteria

- `docker compose config` succeeds.
- Implemented services build.
- App starts with persistent volumes.
- Backup and restore scripts are documented and tested where possible.

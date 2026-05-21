# Agent Task: Backend Foundation

## Goal

Create the initial Django backend structure for the fleet-tracking application.

## Read first

- `AGENTS.md`
- `docs/architecture.md`
- `docs/api-design.md`
- `docs/data-model.md`
- `docs/i18n.md`

## Scope

- Create Django project under `backend/`.
- Add Django REST Framework.
- Configure settings through environment variables.
- Connect to PostgreSQL through `DATABASE_URL`.
- Add `/api/health/`.
- Add backend translation foundation for German and English messages.
- Add placeholder apps:
  - `accounts`
  - `vehicles`
  - `parties`
  - `drivers`
  - `workflows`
  - `damages`
  - `mediafiles`
  - `imports`
  - `audit`
- Add backend tests for settings and health endpoint.
- Add backend Dockerfile.

## Acceptance criteria

- Backend test suite runs.
- Health endpoint works.
- Docker image can build after dependencies are installed.
- Documentation is updated with backend commands.

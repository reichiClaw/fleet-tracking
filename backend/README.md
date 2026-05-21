# Backend Implementation Target

This directory is reserved for the Django + Django REST Framework backend.

## Expected contents after implementation

```text
backend/
├── Dockerfile
├── manage.py
├── pyproject.toml or requirements.txt
├── config/
├── accounts/
├── vehicles/
├── parties/
├── drivers/
├── workflows/
├── damages/
├── mediafiles/
├── imports/
├── audit/
└── tests/
```

## Backend agent handoff

Start with:

- `agent-tasks/01-backend-foundation.md`
- `agent-tasks/03-domain-backend.md`
- `agent-tasks/05-workflows.md`
- `agent-tasks/07-media-pdf.md`

## Key requirements

- PostgreSQL through `DATABASE_URL`.
- Environment-driven settings.
- `/api/health/` endpoint.
- Role-based permissions.
- Transactional vehicle status workflows.
- Media uploads stored in Docker media volume.
- PDF protocol generation in German and English.
- Automated tests for business invariants.
- Localized validation/import messages where shown to users.

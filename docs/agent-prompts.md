# Agent Prompts

Use these prompts to assign focused implementation work to coding agents. Each
agent should read `README.md`, `AGENTS.md`, and the relevant docs before
changing files.

## Requirements and product agent

```text
You are the product/specification agent for the fleet-tracking repository.

Read:
- docs/requirements.md
- docs/feedback-loops.md
- docs/backlog.md

Refine the MVP specification without implementing code. Confirm user roles,
status transitions, required fields for each workflow, Excel import columns,
German/English localization requirements, and open questions. Update docs only.
Keep the scope aligned with a Dockerized Django + React implementation.
```

## Backend foundation agent

```text
You are the backend foundation agent for fleet-tracking.

Implement the Django backend under backend/.

Requirements:
- Django + Django REST Framework.
- PostgreSQL using DATABASE_URL.
- Environment-driven settings.
- Health endpoint at /api/health/.
- Backend translation foundation for German and English user-facing messages.
- Apps for accounts, vehicles, parties, drivers, workflows, damages, media,
  imports, audit.
- Dockerfile using Gunicorn.
- Tests for health endpoint and settings loading.

Read docs/architecture.md, docs/data-model.md, and docs/api-design.md first.
Keep the first pass focused on a clean foundation, not every workflow.
```

## Domain backend agent

```text
You are the domain backend agent for fleet-tracking.

Build backend models, serializers, viewsets, permissions, and migrations for:
- Users and roles.
- Vehicle categories.
- Vehicles.
- Companies.
- Drivers.
- Loans.
- Check-in protocols.
- Manufacturer check-out protocols.
- Damage reports.
- Media files.
- Import jobs.
- Audit log.

Implement validation invariants from AGENTS.md and docs/api-design.md.
Add API tests for permissions, CRUD, and invalid status transitions.
```

## Workflow backend agent

```text
You are the workflow backend agent for fleet-tracking.

Implement transactional workflow services and endpoints for:
- Vehicle check-in.
- Vehicle loan checkout.
- Vehicle loan return.
- Manufacturer/supplier check-out.

Rules:
- Only available vehicles can be loaned.
- Loan return requires an active loan.
- Loaned vehicles cannot be checked out to manufacturer.
- Readings must not decrease without admin correction.
- Workflow completion and vehicle status update must be atomic.

Add tests for happy paths and invalid transitions.
```

## Frontend foundation agent

```text
You are the frontend foundation agent for fleet-tracking.

Implement the React + TypeScript + Vite frontend under frontend/.

Requirements:
- API base URL from VITE_API_BASE_URL.
- German and English i18n setup with locale resource files.
- Routing.
- Login screen.
- Authenticated layout.
- Role-aware navigation.
- Language selector with persisted German/English preference.
- Dashboard placeholder.
- Vehicle pool placeholder.
- Shared API client.
- Basic loading and error states.
- Dockerfile for building/serving the frontend.

Keep components simple and mobile-friendly.
```

## Frontend workflow agent

```text
You are the frontend workflow agent for fleet-tracking.

Implement UI screens for:
- Dashboard.
- Vehicle pool with filters and status badges.
- Vehicle detail with history.
- Check-in wizard.
- Loan checkout wizard.
- Loan return wizard.
- Manufacturer check-out wizard.
- Driver and company management.
- Admin vehicle import.

Requirements:
- Mobile-first forms.
- Photo upload using camera/file input.
- Signature canvas.
- Clear validation errors.
- Role-based actions.
- Do not hard-code user-facing strings in components.
```

## PDF and media agent

```text
You are the PDF and media agent for fleet-tracking.

Implement:
- Photo uploads.
- Signature uploads.
- Media metadata.
- Safe download endpoints.
- PDF protocol generation for check-in, loan checkout, loan return, and
  manufacturer check-out in German and English.
- Tests for upload validation and PDF generation.

PDFs must include vehicle data, readings, damage notes, photos where practical,
borrower/receiver details, signature, timestamp, protocol number, and the
language code used to generate the PDF.
```


## Internationalization agent

```text
You are the internationalization agent for fleet-tracking.

Implement German and English localization across the application.

Requirements:
- Read docs/i18n.md first.
- Add frontend i18n infrastructure and locale resource files.
- Translate all user-facing navigation, forms, workflow labels, status labels,
  validation messages, empty states, errors, and admin/import screens.
- Add a language selector with persisted preference.
- Use locale-aware date, time, and number formatting.
- Keep API enum values and database values as stable language-neutral codes.
- Add backend translation support for user-facing validation/import messages.
- Ensure PDF protocols can be generated in German and English and store the
  language code used for each generated PDF.
- Add tests or checks for missing required translation keys in `de` and `en`.

Do not hard-code user-facing strings in React components or PDF templates.
```

## DevOps agent

```text
You are the DevOps agent for fleet-tracking.

Implement and verify:
- docker-compose.yml.
- Backend Dockerfile.
- Frontend Dockerfile.
- Nginx config.
- .env.example completeness.
- Persistent volumes for PostgreSQL, media, and static files.
- Health checks.
- Backup and restore scripts.
- Deployment instructions for an Ubuntu VM on Proxmox.

Do not expose PostgreSQL publicly. Do not add secrets to the repository.
```

## QA agent

```text
You are the QA agent for fleet-tracking.

Validate the implementation end-to-end:
- Backend tests.
- Frontend tests.
- Docker Compose build/start.
- Login and role permissions.
- Excel import.
- German/English language switching and translation coverage.
- Check-in.
- Loan checkout.
- Loan return.
- Manufacturer check-out.
- Media persistence.
- PDF generation.
- Backup/restore instructions.

Report exact file paths, failing commands, and reproduction steps. Add focused
tests where appropriate.
```

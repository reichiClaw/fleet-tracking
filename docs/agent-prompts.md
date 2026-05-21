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
and open questions. Update docs only. Keep the scope aligned with a Dockerized
Django + React implementation.
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
- Routing.
- Login screen.
- Authenticated layout.
- Role-aware navigation.
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
  manufacturer check-out.
- Tests for upload validation and PDF generation.

PDFs must include vehicle data, readings, damage notes, photos where practical,
borrower/receiver details, signature, timestamp, and protocol number.
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

# Implementation Backlog

## Epic 1: Repository and project foundation

### Task 1.1: Backend project scaffold

- Create Django project under `backend/`.
- Add Django REST Framework.
- Configure environment-driven settings.
- Add PostgreSQL connection using `DATABASE_URL`.
- Add health endpoint.
- Add backend Dockerfile.

Acceptance criteria:

- Backend starts locally.
- `/api/health/` returns OK.
- Migrations can run against PostgreSQL.

### Task 1.2: Frontend project scaffold

- Create React + TypeScript + Vite project under `frontend/`.
- Add routing, API client, and authenticated layout.
- Add frontend Dockerfile.

Acceptance criteria:

- Frontend starts locally.
- API base URL is read from environment.
- Basic layout renders.

### Task 1.3: Tooling and quality

- Add format/lint/test commands.
- Add CI-ready scripts.
- Document local development.

Acceptance criteria:

- Backend and frontend tests can run independently.
- README documents common commands.

## Epic 2: Authentication and roles

### Task 2.1: User model and authentication

- Implement users and login/logout.
- Configure sessions or JWT.
- Add current user endpoint.

Acceptance criteria:

- Users can log in and out.
- Protected API endpoints reject anonymous users.

### Task 2.2: Role-based permissions

- Add Admin, Operations, and optional Read-only roles.
- Restrict admin endpoints.

Acceptance criteria:

- Operations users cannot manage users or imports.
- Admin users can access all admin functions.

## Epic 3: Master data

### Task 3.1: Vehicle categories

- CRUD for categories.
- Active/inactive flag.

Acceptance criteria:

- Admin can manage categories.
- Inactive categories are hidden from creation forms.

### Task 3.2: Vehicles

- CRUD for vehicles.
- Current status and readings.
- Detail and history endpoints.

Acceptance criteria:

- Vehicle detail shows current state.
- Status cannot be changed to invalid values directly.

### Task 3.3: Companies and drivers

- CRUD for companies and fixed drivers.
- Driver selection should prefill loan borrower data.

Acceptance criteria:

- Operations users can select active drivers during loan creation.
- Admins can deactivate records.

## Epic 4: Vehicle lifecycle workflows

### Task 4.1: Check-in

- Capture readings, condition, damage notes, photos, and optional signature.
- Set vehicle to available or damaged/maintenance based on input.

Acceptance criteria:

- Check-in creates a protocol.
- Vehicle history includes the event.
- Status transition is atomic.

### Task 4.2: Loan checkout

- Capture borrower, expected return, readings, photos, and signature.
- Mark vehicle loaned.

Acceptance criteria:

- Only available vehicles can be loaned.
- Vehicle pool immediately shows unavailable state.

### Task 4.3: Loan return

- Capture return readings, damage notes, and photos.
- Close active loan.
- Mark vehicle available, damaged, or maintenance.

Acceptance criteria:

- Only active loans can be returned.
- Return readings are validated.

### Task 4.4: Manufacturer check-out

- Capture final readings, condition, photos, and receiver.
- Mark vehicle checked out to manufacturer/supplier.

Acceptance criteria:

- Loaned vehicles cannot be checked out.
- Checked-out vehicles are hidden from active pool by default.

## Epic 5: Media, signatures, and PDFs

### Task 5.1: Media upload

- Upload photos and signatures.
- Link media to vehicles, workflows, loans, and damage reports.
- Validate file type and size.

Acceptance criteria:

- Multiple photos can be uploaded.
- Media persists after container restart.

### Task 5.2: Signature capture

- Add frontend canvas signature component.
- Store signature image as media.

Acceptance criteria:

- Signatures are visible in workflow history.
- Required signatures block workflow completion.

### Task 5.3: PDF protocols

- Generate PDFs for check-in, loan checkout, loan return, and manufacturer
  check-out.
- Store PDF as immutable media.

Acceptance criteria:

- Each completed workflow can produce a PDF.
- PDF includes readings, borrower/receiver data, damage, photos, and signature.

## Epic 6: Frontend workflows and UX

### Task 6.1: Dashboard

- Availability counts.
- Overdue loans.
- Recent workflow activity.

Acceptance criteria:

- Dashboard summarizes status at a glance.

### Task 6.2: Vehicle pool

- Filterable table/card view.
- Status badges and quick actions.

Acceptance criteria:

- Users can quickly find available vehicles by category/status.

### Task 6.3: Workflow wizards

- Build mobile-friendly multi-step forms for check-in, loan, return, and
  manufacturer check-out.

Acceptance criteria:

- Workflows are usable on tablets and phones.
- Validation errors are field-specific.

## Epic 7: Excel import

### Task 7.1: Import template and parser

- Define Excel columns.
- Implement row validation.

Acceptance criteria:

- Invalid rows return actionable messages.

### Task 7.2: Import commit

- Create/update vehicles only after successful validation.
- Store import job result.

Acceptance criteria:

- Import is auditable.
- Partial failures do not create inconsistent data.

## Epic 8: Audit and administration

### Task 8.1: Audit log

- Add append-only audit records for key actions.

Acceptance criteria:

- Admins can view audit entries.
- Audit entries cannot be modified through API.

### Task 8.2: Admin UI

- Users, roles, categories, vehicles, drivers, companies, imports.

Acceptance criteria:

- Admin workflows are available through the frontend or Django admin for MVP.

## Epic 9: Docker and deployment

### Task 9.1: Compose stack

- Backend, frontend, PostgreSQL, optional Nginx.
- Persistent volumes.
- Health checks.

Acceptance criteria:

- `docker compose up -d --build` starts all implemented services.

### Task 9.2: Backup and restore

- Add database and media backup scripts.
- Add restore instructions.

Acceptance criteria:

- A test restore can recreate database and media state.

## Epic 10: QA and hardening

### Task 10.1: Backend tests

- Status transitions.
- Workflow permissions.
- Import validation.
- Media validation.

Acceptance criteria:

- Business invariants are covered.

### Task 10.2: Frontend tests

- Form validation.
- Route guards.
- Workflow happy paths with mocked API.

Acceptance criteria:

- Main UI flows have automated coverage.

### Task 10.3: Deployment readiness review

- Security settings.
- Nginx config.
- Environment variables.
- Backup plan.

Acceptance criteria:

- Production checklist in `docs/deployment.md` is satisfied.

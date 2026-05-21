# Implementation Plan

This plan turns the product and architecture documents into a concrete sequence
of agent-executable work.

## Phase 1: Foundation

Deliverables:

- Django backend scaffold.
- React frontend scaffold.
- PostgreSQL connection.
- Dockerfiles.
- Development Compose stack.
- Health endpoint.
- Basic README commands.

Use:

- `agent-tasks/01-backend-foundation.md`
- `agent-tasks/02-frontend-foundation.md`
- `agent-tasks/06-devops.md`

Exit criteria:

- Backend health endpoint works.
- Frontend loads.
- Database migrations run.
- Compose stack starts implemented services.

## Phase 2: Domain model and admin basics

Deliverables:

- Users and roles.
- Categories.
- Vehicles.
- Companies.
- Drivers.
- Admin interfaces or API endpoints.
- Initial tests for permissions and CRUD.

Use:

- `agent-tasks/03-domain-backend.md`
- `agent-tasks/04-admin-import.md`

Exit criteria:

- Admin can create users, vehicles, categories, companies, and drivers.
- Operations users have limited permissions.

## Phase 3: Core workflows

Deliverables:

- Vehicle check-in.
- Loan checkout.
- Loan return.
- Manufacturer check-out.
- Status transition validation.
- Audit logging.

Use:

- `agent-tasks/05-workflows.md`

Exit criteria:

- All four workflows pass backend API tests.
- Invalid transitions are rejected.
- Vehicle history is queryable.

## Phase 4: Media, signatures, and PDFs

Deliverables:

- Photo upload.
- Signature upload/capture.
- Damage reports.
- PDF protocol generation.
- Media download authorization.

Use:

- `agent-tasks/07-media-pdf.md`

Exit criteria:

- Photos and signatures persist in Docker volumes.
- PDFs are generated and linked to workflow history.

## Phase 5: Frontend workflows

Deliverables:

- Dashboard.
- Vehicle pool.
- Vehicle details.
- Workflow wizards.
- Admin screens or links to Django admin for MVP.

Use:

- `agent-tasks/08-frontend-workflows.md`

Exit criteria:

- Operations users can complete MVP workflows through the UI.
- UI is usable on tablet/mobile widths.

## Phase 6: Excel import

Deliverables:

- Import template.
- Excel parser.
- Validation report.
- Commit endpoint.
- Import UI.

Use:

- `agent-tasks/04-admin-import.md`

Exit criteria:

- Admin can upload a sample vehicle Excel file.
- Invalid rows are reported.
- Valid rows create/update vehicles.

## Phase 7: Deployment hardening and QA

Deliverables:

- Production Compose config.
- Nginx config.
- Backup and restore scripts.
- Deployment documentation.
- End-to-end tests or manual acceptance checklist.

Use:

- `agent-tasks/06-devops.md`
- `agent-tasks/09-qa.md`

Exit criteria:

- App runs on a Proxmox Ubuntu VM.
- Persistent data survives restart.
- Backup and restore procedure is verified.
- Security checklist is reviewed.

## Definition of done

- Login works for Admin and Operations users.
- Admin can manage users, vehicles, categories, companies, drivers, and imports.
- Operations user can check in, loan, return, and manufacturer-check-out
  vehicles.
- Vehicle pool displays availability and expected returns.
- Damage notes, photos, and signatures are stored.
- PDF protocols are generated.
- Audit log captures important changes.
- Docker Compose deployment is documented and repeatable.

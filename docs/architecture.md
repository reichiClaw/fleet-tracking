# Architecture

## Architecture style

Use a modular monolith. The domain is highly relational and the workflows share
one consistent state model, so a single backend with clear modules is simpler
and safer than microservices.

## Recommended stack

- Backend: Django + Django REST Framework
- Frontend: React + TypeScript + Vite
- Internationalization: German and English via structured translation resources
- Database: PostgreSQL
- Media storage: local Docker volume for MVP, optional MinIO/S3 later
- PDF generation: backend service using stored workflow data
- Deployment: Docker Compose on a Proxmox-hosted Ubuntu VM
- Reverse proxy: Nginx or an existing external proxy

## Runtime topology

```text
Browser
  |
  | HTTPS
  v
Nginx / reverse proxy
  |
  +-- Frontend static assets
  |
  +-- /api -> Django REST API
             |
             +-- PostgreSQL
             +-- media volume: photos, signatures, PDFs
```

## Backend modules

### accounts

- Users.
- Roles.
- Login/logout.
- Permissions.

### vehicles

- Vehicle master data.
- Categories.
- Current status and current readings.
- Vehicle history queries.

### parties

- Companies/subcontractors.
- Manufacturers/suppliers.
- Internal organizational units.

### drivers

- Fixed employees/drivers.
- Contact data.
- Active/inactive state.
- Optional category authorizations.

### workflows

- Check-in.
- Loan checkout.
- Loan return.
- Manufacturer check-out.
- Status transitions.
- Business validations.

### damages

- Damage reports.
- Severity.
- Open/resolved state.
- Links to workflow events and media.

### media

- Uploaded photos.
- Signature images.
- Generated PDF files.
- Metadata and authorization.

### imports

- Excel uploads.
- Row validation.
- Import job history.
- Commit/rollback behavior.

### audit

- Append-only activity log.
- Important entity changes.
- Workflow completions.
- User and permission changes.

## Frontend modules

### Application shell

- Authenticated layout.
- Role-aware navigation.
- Global error handling.
- API connectivity status.

### Dashboard

- Availability counts.
- Loaned vehicles.
- Overdue expected returns.
- Damaged/maintenance vehicles.

### Vehicle pool

- Filterable list and optional card view.
- Status badges.
- Quick actions based on role/status.

### Workflow wizards

- Check-in wizard.
- Loan checkout wizard.
- Loan return wizard.
- Manufacturer check-out wizard.
- Photo upload and signature capture steps.


### i18n

- German and English translation resources.
- Language selector and persisted preference.
- Locale-aware date, time, and number formatting.
- Shared translated status labels.
- Translation coverage checks for both languages.

### Admin area

- User management.
- Vehicle import.
- Categories.
- Drivers.
- Companies.

## Data consistency rules

- Workflow completion and vehicle status update must happen in one database
  transaction.
- Vehicle status must only change through allowed transitions.
- Loan return must reference one active loan.
- Generated PDFs should reflect immutable stored data, not current mutable form
  state.
- Media records must belong to a vehicle, workflow, damage report, or document.

## Authentication choice

For an internal application, Django session authentication is a good default if
frontend and backend share the same site origin through Nginx. JWT can be used
if the deployment requires separate domains or independent clients.

## Media storage choice

- Store only metadata and server-generated storage keys in PostgreSQL.
- Select the storage backend with the `MEDIA_STORAGE_BACKEND` environment
  variable (`local`, `sftp`, or `s3`); see `config/storage.py` and
  `docs/deployment.md`.
  - `local` (default): a Docker volume mounted into the backend.
  - `sftp`: a remote SFTP/NAS server via django-storages + paramiko.
  - `s3`: S3-compatible object storage / MinIO via boto3.
- All backends are served through authenticated Django download endpoints, so
  none needs to expose public object URLs.

## PDF strategy

- Generate PDFs in the backend after workflow completion.
- Support German and English PDF labels, titles, and status text.
- Store the language code used to generate each PDF.
- Store generated PDFs as media records.
- Use a stable protocol number.
- Treat generated PDFs as immutable.
- Regenerate only through an explicit admin correction process.

## Audit strategy

Audit log entries should be append-only and created for:

- User and role changes.
- Vehicle create/update/archive.
- Status transitions.
- Workflow create/complete/cancel.
- Uploads and deletions.
- PDF generation.
- Import validation and commit.

## Testing strategy

Backend:

- Unit tests for validators and status transitions.
- API tests for roles and permissions.
- Workflow integration tests.
- Import parsing tests.
- Media upload validation tests.
- PDF generation tests.

Frontend:

- Component tests for shared UI and forms.
- API mocking for workflow screens.
- Route guard tests.
- Basic responsive layout checks.

End-to-end:

- Admin creates/imports vehicles.
- Operations user checks in a vehicle.
- Operations user loans the vehicle.
- Operations user returns the vehicle.
- Operations user checks vehicle out to manufacturer.
- Photos, signatures, and PDFs are present in history.

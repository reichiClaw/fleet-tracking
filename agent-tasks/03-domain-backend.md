# Agent Task: Domain Backend

## Goal

Implement the core backend domain model, APIs, and permissions.

## Read first

- `docs/requirements.md`
- `docs/data-model.md`
- `docs/api-design.md`
- `AGENTS.md`

## Scope

- Users and roles.
- Vehicle categories.
- Vehicles.
- Companies and manufacturers/suppliers.
- Fixed drivers/employees.
- Loans.
- Check-in protocols.
- Manufacturer check-out protocols.
- Damage reports.
- Media metadata.
- Import jobs.
- Audit log.

## Required behavior

- Role-based access control.
- Status transition validation.
- Basic admin registration.
- API serializers and viewsets.
- Tests for CRUD, permissions, and business invariants.

## Acceptance criteria

- Migrations are present.
- Admin can manage master data.
- Operations users can read and create operational records where permitted.
- Read-only users cannot mutate records.
- Invalid status changes are rejected.

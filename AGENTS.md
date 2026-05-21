# Agent Guidance

This repository is prepared for multiple implementation agents. Keep changes
small, documented, and aligned with the product requirements in `docs/`.

## Working rules

- Follow the architecture in `docs/architecture.md`.
- Keep backend code under `backend/` and frontend code under `frontend/`.
- Keep deployment assets under `deploy/` and operational scripts under
  `scripts/`.
- Update documentation when implementation decisions change.
- Add tests for every business workflow that changes vehicle status.
- Add German and English translations for every new user-facing label, message,
  status display, and PDF field.
- Do not commit secrets. Use `.env.example` as the template.

## Recommended implementation order

1. Backend foundation, models, migrations, auth, permissions.
2. Core workflow API: check-in, loan checkout, loan return, manufacturer
   checkout.
3. Media uploads, signatures, PDF protocol generation.
4. Frontend shell, auth, dashboard, vehicle pool.
5. Frontend workflow wizards.
6. Excel import and admin screens.
7. Docker Compose, Nginx, backup/restore scripts.
8. QA pass and end-to-end workflow tests.

## Critical invariants

- Only available vehicles can be loaned.
- Loaned vehicles cannot be checked out to manufacturers.
- Vehicle return requires an active loan.
- Odometer and operating hour values must not decrease without an explicit
  admin correction workflow.
- Workflow completion and vehicle status updates must happen atomically.
- PDF protocols should be generated from stored data and treated as immutable.
- Uploaded media paths must be generated server-side; never trust user-provided
  filenames for storage paths.
- Store stable status/workflow codes and translate labels at the presentation
  layer.
- Generated PDFs must record whether they were created in German or English.

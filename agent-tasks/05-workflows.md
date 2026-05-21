# Agent Task: Core Workflows

## Goal

Implement the transactional operational workflows.

## Read first

- `docs/requirements.md`
- `docs/api-design.md`
- `docs/data-model.md`
- `AGENTS.md`

## Workflows

### Check-in

- Capture vehicle, readings, condition notes, damages, photos, and optional
  signature.
- Mark vehicle available, damaged, or maintenance.

### Loan checkout

- Capture vehicle, company/driver/borrower details, expected return, readings,
  damages, photos, and signature.
- Mark vehicle loaned and unavailable.

### Loan return

- Capture return readings, return condition, damages, and photos.
- Close active loan.
- Mark vehicle available, damaged, or maintenance.

### Manufacturer check-out

- Capture receiver, readings, condition, damages, photos, and optional
  signature.
- Mark vehicle checked out to manufacturer/supplier.

## Required invariants

- Only available vehicles can be loaned.
- Loaned vehicles cannot be manufacturer-checked-out.
- Loan return requires one active loan.
- Readings must not decrease unless a future admin correction flow exists.
- Status updates and workflow records must be saved atomically.

## Acceptance criteria

- API endpoints implement all four workflows.
- Vehicle history reflects each workflow.
- Tests cover happy paths and invalid transitions.
- Audit log entries are created for completed workflows.

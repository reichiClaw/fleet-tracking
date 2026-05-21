# Agent Task: Admin and Excel Import

## Goal

Implement admin-facing management and Excel import for vehicle setup.

## Read first

- `docs/requirements.md`
- `docs/backlog.md`
- `docs/data-model.md`
- `docs/i18n.md`

## Scope

- Admin screens or Django admin configuration for:
  - Users.
  - Roles.
  - Vehicle categories.
  - Vehicles.
  - Companies.
  - Drivers.
- Vehicle Excel import.
- Import template documentation.
- Row-level validation.
- Localized German and English import validation messages where shown to users.
- Import job history.

## Suggested vehicle import columns

- `internal_number`
- `category`
- `manufacturer`
- `model`
- `serial_number`
- `license_plate`
- `current_odometer_km`
- `current_operating_hours`
- `current_location`
- `supplier`
- `notes`

## Acceptance criteria

- Admin can upload an Excel file.
- Invalid rows return row numbers and messages.
- Valid imports create or update vehicles according to documented rules.
- Import does not partially commit invalid files.
- Import actions are logged.

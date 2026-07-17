# Vehicle Excel Import

Admins can validate and commit vehicle imports through the backend API.

## Endpoints

- `POST /api/v1/imports/vehicles/` with multipart field `file`: uploads an
  `.xlsx` or `.xlsm` workbook, validates all rows, stores an `ImportJob`, and
  returns row-level validation results.
- `POST /api/v1/imports/{id}/commit/`: commits a validated vehicle import job.
- `GET /api/v1/imports/{id}/`: retrieves import metadata and results.
- `GET /api/v1/imports/`: lists import jobs.

## Columns

The first worksheet must contain a header row. Supported columns are:

| Column | Required | Behavior |
|---|---:|---|
| `internal_number` | No | Unique fleet number and update key when present; generated for a new row when blank. |
| `category` | No | Active category name; unknown, inactive, or blank values use the `Sonstiges` fallback. |
| `manufacturer` | Yes | Stored on the vehicle. |
| `model` | Yes | Stored on the vehicle. |
| `serial_number` | No | Must be unique when present. Blank clears the field on update. |
| `license_plate` | No | Must be unique when present. Blank clears the field on update. |
| `current_odometer_km` | No | Non-negative integer applied when a vehicle is created. Existing readings are not overwritten by imports. |
| `current_operating_hours` | No | Non-negative decimal applied when a vehicle is created. Existing readings are not overwritten by imports. |
| `current_location` | No | Stored on the vehicle. Blank clears the field on update. |
| `supplier` | No | Captured in import results for audit; no vehicle field exists yet. |
| `notes` | No | Stored on the vehicle. Blank clears the field on update. |

## Commit rules

- Validation checks every data row before any vehicle is created or updated.
- Blank rows are ignored.
- If any row has an error, the job status is `failed` and commit is blocked.
- New vehicles are created with status `announced`.
- Existing vehicles are matched by `internal_number` and updated in place.
- Existing odometer and operating-hour readings remain workflow-owned and are
  deliberately not changed by a delayed import commit.
- Import validation and commit actions are recorded in the audit log.


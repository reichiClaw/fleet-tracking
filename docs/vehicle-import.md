# Vehicle Excel Import

Admins can validate and commit vehicle imports through the backend API.

## Endpoints

- `POST /api/v1/imports/vehicles/` with multipart field `file`: uploads an
  `.xlsx` or `.xlsm` workbook, validates all rows, stores an `ImportJob`, and
  returns row-level validation results.
- `POST /api/v1/imports/{id}/commit/`: commits a validated vehicle import job.
- `POST /api/v1/imports/{id}/exclude-rows/`: stores the complete
  `row_numbers` exclusion list and recalculates whether included rows are valid.
- `GET /api/v1/imports/{id}/`: retrieves import metadata and results.
- `GET /api/v1/imports/`: lists import jobs.
- `GET /api/v1/imports/vehicle-template/`: downloads a German/English template
  selected by the request language.
- `GET /api/v1/imports/{id}/errors-csv/`: downloads field-level errors.
- `GET /api/v1/imports/{id}/generated-ids-csv/`: after commit, downloads source
  rows, actions, vehicle IDs, generated internal numbers, and external keys.

## Columns

The first worksheet must contain a header row. Supported columns are:

| Column | Required | Behavior |
|---|---:|---|
| `external_key` | No | Stable unique source-system key and preferred update key. |
| `internal_number` | No | Unique fleet number and update key when present; generated for a new row when blank. |
| `category` | No | Active category name; unknown, inactive, or blank values use the `Sonstiges` fallback. |
| `manufacturer` | Yes | Stored on the vehicle. |
| `model` | Yes | Stored on the vehicle. |
| `serial_number` | No | Must be unique when present. Blank clears the field on update. |
| `license_plate` | No | Must be unique when present. Blank clears the field on update. |
| `current_odometer_km` | No | Non-negative integer applied when a vehicle is created. Existing readings are not overwritten by imports. |
| `current_operating_hours` | No | Non-negative decimal applied when a vehicle is created. Existing readings are not overwritten by imports. |
| `current_location` | No | Stored on the vehicle. Blank clears the field on update. |
| `supplier` | No | Matched to an active supplier/manufacturer or returned as an explicit create proposal; never silently created. |
| `notes` | No | Stored on the vehicle. Blank clears the field on update. |

Localized template labels are accepted aliases for the stable columns above.

## Validation result contract

Each result row includes:

- `row_number`, normalized `data`, `errors`, and `excluded`;
- `present_fields`, preserving which source columns were actually present;
- `diff[]` with `field`, `old`, `new`, `changed`, and `explicit_clear`;
- `duplicate_candidates` based on stable IDs and vehicle identifiers;
- `supplier_proposal` with match/proposal status.

A missing column means “leave the existing value unchanged”. A present blank
cell means an explicit clear for clearable text fields. Category fallback and
all clears are visible in the diff before commit.

## Commit rules

- Validation checks every data row before any vehicle is created or updated.
- Blank rows are ignored.
- If any row has an error, the job status is `failed` and commit is blocked.
- Errors on explicitly excluded rows do not block commit.
- New vehicles are created with status `announced`.
- Existing vehicles are matched by `external_key` first, then
  `internal_number`, and updated in place.
- Existing odometer and operating-hour readings remain workflow-owned and are
  deliberately not changed by a delayed import commit.
- Commit locks the import job and matched vehicles, verifies each row's
  validation fingerprint, and applies all included rows atomically.
- A database or row conflict rolls back the entire commit.
- Import validation and commit actions are recorded in the audit log.


# API Design

## Principles

- Base path: `/api/v1/`.
- JSON request and response bodies.
- Multipart upload endpoints for media.
- UUID identifiers.
- ISO 8601 timestamps.
- Paginated list endpoints.
- Role-based permissions.
- German and English localization for user-facing API messages.
- Explicit workflow action endpoints.
- Consistent validation error format.

## Common responses

### Pagination

```json
{
  "count": 100,
  "next": "/api/v1/vehicles/?page=2",
  "previous": null,
  "results": []
}
```

### Validation error

```json
{
  "error": {
    "code": "invalid",
    "message": "Request validation failed.",
    "details": {
      "field": ["Message"]
    }
  }
}
```

### Permission error

```json
{
  "error": {
    "code": "permission_denied",
    "message": "You do not have permission to perform this action.",
    "details": {}
  }
}
```


## Localization

Supported languages are German (`de`) and English (`en`). Clients should send
the preferred language using `Accept-Language` or a user profile preference.
Backend enum values and API field names remain stable English codes, while
user-facing labels and messages can be localized.

PDF generation endpoints should accept an optional language code. If omitted,
use the current user's language preference or deployment default.

Example:

```json
{
  "language": "de"
}
```

## Authentication

| Method | Path | Description |
|---|---|---|
| GET | `/auth/csrf/` | Issue the CSRF cookie required for writes |
| POST | `/auth/login/` | Authenticate user |
| POST | `/auth/logout/` | End session/token |
| GET | `/auth/me/` | Current user profile |

The browser client uses a same-origin Django session. Every unsafe request sends
the CSRF cookie value in `X-CSRFToken`.

## Users

Admin only except own profile.

| Method | Path | Description |
|---|---|---|
| GET | `/users/` | List users |
| POST | `/users/` | Create user |
| GET | `/users/{id}/` | Retrieve user |
| PATCH | `/users/{id}/` | Update user |
| POST | `/users/{id}/deactivate/` | Deactivate user |
| POST | `/users/{id}/set-password/` | Change/reset a password |
| POST | `/users/{id}/set-temporary-password/` | Admin sets a temporary password |

Passwords cannot be changed through `PATCH`. A user changing their own password
must send `current_password` and `new_password`; an application admin resetting
a non-superuser sends `new_password`. Temporary-password and admin reset actions
set `must_change_password=true`; changing one's own password clears it.
`GET /auth/me/` returns `effective_role` and capability flags. A Django
superuser always has the effective application role `admin`, regardless of the
stored application role.

## Vehicle categories

| Method | Path | Description |
|---|---|---|
| GET | `/vehicle-categories/` | List categories |
| POST | `/vehicle-categories/` | Create category |
| GET | `/vehicle-categories/{id}/` | Retrieve category |
| PATCH | `/vehicle-categories/{id}/` | Update category |
| POST | `/vehicle-categories/{id}/deactivate/` | Deactivate category |
| POST | `/vehicle-categories/{id}/reactivate/` | Reactivate category |

`meter_mode` is one of `odometer`, `hours`, `both`, or `none`. Category
responses include the read-only `vehicle_count` used to explain deactivation
impact without downloading the entire vehicle pool.

## Vehicles

| Method | Path | Description |
|---|---|---|
| GET | `/vehicles/` | List vehicles |
| POST | `/vehicles/` | Create vehicle |
| GET | `/vehicles/{id}/` | Retrieve vehicle |
| PATCH | `/vehicles/{id}/` | Update vehicle |
| POST | `/vehicles/{id}/archive/` | Archive a manufacturer-returned vehicle; requires `reason` |
| POST | `/vehicles/{id}/unarchive/` | Audited safe archive correction; requires `reason` |
| POST | `/vehicles/{id}/admin-correct/` | Admin-only status/meter correction with `reason` |
| POST | `/vehicles/{id}/send-to-maintenance/` | Start maintenance |
| POST | `/vehicles/{id}/complete-maintenance/` | Complete active maintenance |
| GET | `/vehicles/{id}/active-loan/` | Retrieve the active loan |
| GET | `/vehicles/{id}/workflow-context/` | Meter baseline, loan, damages, reservations and capabilities |
| GET | `/vehicles/{id}/history/` | Full chronological condition/workflow timeline |
| GET | `/vehicles/{id}/media/` | Vehicle media |
| GET | `/vehicles/typeahead/` | Paginated active-pool typeahead |
| GET | `/vehicles/qr-bulk/` | Admin-only paginated QR rows; active only by default |

Bulk QR rows expose the canonical public SPA URL
`{PUBLIC_BASE_URL}/v/{qr_code}`; clients must not encode an API lookup URL.

`POST /vehicles/` always creates `announced`; a client-supplied `status` cannot
put the vehicle into the available pool. `PATCH` never accepts `status`.
Operational state changes use workflow actions. `admin-correct` accepts only
`announced`, `checked_in`, `available`, `damaged`, or `maintenance`, requires a
reason, and rejects corrections inconsistent with active loans, maintenance, or
open damage.

Vehicle list/retrieve responses include:

- `meter_requirements`: `mode`, required flags, and current baselines;
- `active_loan`, `open_damage_count`, and `reservation_summary.current/upcoming`;
- stable `capabilities` flags and `next_actions` objects (`action`, `method`,
  `url`).

Supported filters:

- `status`
- `category`
- `manufacturer`
- `location`
- `is_available`
- `active`
- `search`

## Companies

| Method | Path | Description |
|---|---|---|
| GET | `/companies/` | List companies |
| POST | `/companies/` | Create company |
| GET | `/companies/{id}/` | Retrieve company |
| PATCH | `/companies/{id}/` | Update company |
| POST | `/companies/{id}/deactivate/` | Deactivate company |
| GET | `/companies/typeahead/` | Paginated server-side typeahead |
| GET | `/companies/duplicates/` | Admin duplicate suggestions |
| POST | `/companies/{id}/merge/` | Admin preview/confirmed merge |

Merge without `confirmation_token` returns a signed, short-lived confirmation
token. Resubmit the same source/target pair with that token to reassign related
records and deactivate the source.

## Drivers

| Method | Path | Description |
|---|---|---|
| GET | `/drivers/` | List drivers |
| POST | `/drivers/` | Create driver |
| GET | `/drivers/{id}/` | Retrieve driver |
| PATCH | `/drivers/{id}/` | Update driver |
| POST | `/drivers/{id}/deactivate/` | Deactivate driver |
| GET | `/drivers/typeahead/` | Paginated server-side typeahead |
| GET | `/drivers/duplicates/` | Admin duplicate suggestions |
| POST | `/drivers/{id}/merge/` | Admin preview/confirmed merge |

## Check-in workflow

| Method | Path | Description |
|---|---|---|
| POST | `/workflows/check-ins/` | Create check-in protocol |
| POST | `/workflows/check-ins/create-and-check-in/` | Atomically create vehicle and complete check-in |
| GET | `/workflows/check-ins/{id}/` | Retrieve check-in |
| POST | `/workflows/check-ins/{id}/generate-pdf/` | Generate protocol PDF |

Check-in completion is atomic. Clients should send an `Idempotency-Key` header
(maximum 128 characters) and reuse it when retrying the same request. Reusing a
key for a different actor, vehicle, or payload is rejected.

The existing-vehicle request requires `vehicle`, `supplier_company`,
`condition_outcome`, and category-applicable `odometer_km` /
`operating_hours`. The create-and-check-in request adds vehicle master fields
(`category`, `manufacturer`, `model`, and optional identifiers/location) and
uses the same evidence fields. Both accept `performed_at`, `condition_notes`,
general `media_file_ids`, and nested `damage_reports[]` with
`description`, optional `severity`/`discovered_at`, and `media_file_ids`.
`condition_outcome` is `fit`, `new_damage`, or `maintenance`; `new_damage`
requires at least one damage report and `maintenance` requires a reason in
`condition_notes`.

Success is `201`; an identical idempotent replay is `200`. The response is the
protocol serializer plus `capabilities` and `next_actions`. Database changes
are atomic. PDF creation is attempted from the immutable snapshot before
completion returns; a storage/render failure is persisted and exposed in the
document register for retry rather than discarding the authoritative workflow.

## Loan workflow

| Method | Path | Description |
|---|---|---|
| POST | `/loans/` | Create active loan and mark vehicle unavailable |
| GET | `/loans/` | List loans |
| GET | `/loans/{id}/` | Retrieve loan |
| POST | `/loans/{id}/return/` | Return active loan |
| GET | `/loans/{id}/return-context/` | Immutable checkout and current return context |
| POST | `/loans/{id}/generate-checkout-pdf/` | Generate loan checkout PDF |
| POST | `/loans/{id}/generate-return-pdf/` | Generate loan return PDF |
| GET | `/loans/typeahead/` | Paginated filtered typeahead |

Checkout accepts optional `reservation_id`. It locks the reservation and
vehicle, validates vehicle/time/party, prefills omitted party fields from the
immutable reservation snapshot, and marks the reservation `fulfilled` with
`fulfilled_at`, `fulfilled_by`, and `loan` in the same transaction. Checkout
without the selected reservation is blocked by a current reservation or one
starting before the requested return; the configured early-handover window
controls how early a selected reservation can be fulfilled.

Return requires `condition_outcome` (`fit`, `new_damage`, `maintenance`) and all
category-applicable readings. Status is server-derived: unresolved damage keeps
the vehicle `damaged`; maintenance creates an active maintenance record; only a
fit vehicle without open damage becomes `available`. The return signature is
optional unless `RETURN_SIGNATURE_REQUIRED` is enabled.

`return-context` includes current vehicle identity and meter baseline, borrower
name/company/driver/phone, expected return, checkout snapshot/readings/media
(including authorized signature evidence), open damage, and
`signature_required`.

## Reservations

| Method | Path | Description |
|---|---|---|
| GET/POST | `/reservations/` | Paginated list/create |
| GET/PATCH | `/reservations/{id}/` | Retrieve/edit active reservation |
| POST | `/reservations/{id}/cancel/` | Cancel active reservation |
| POST | `/reservations/{id}/mark-no-show/` | Mark started reservation no-show |
| GET | `/reservations/typeahead/` | Paginated active typeahead |

Statuses are `active`, `cancelled`, `fulfilled`, and `no_show`. Choose exactly
one party mode: `driver` (optionally with its company), `company` using its
stored contact, or manual `reserved_for` plus `manual_phone`. Party identity is
snapshotted and cannot be edited in place; replace the reservation to change
the party. Time/notes on active reservations remain editable.

## Manufacturer check-out workflow

| Method | Path | Description |
|---|---|---|
| POST | `/workflows/manufacturer-checkouts/` | Create manufacturer check-out |
| GET | `/workflows/manufacturer-checkouts/{id}/` | Retrieve check-out |
| POST | `/workflows/manufacturer-checkouts/{id}/generate-pdf/` | Generate protocol PDF |

`/workflows/manufacturer-returns/` is the preferred alias; the legacy
`manufacturer-checkouts` route remains available. Eligibility is intentionally
limited to `available` or `damaged` vehicles with no active loan. An active
manufacturer or supplier `recipient_company` and category-applicable readings
are required. `maintenance`, `loaned`, `announced`, archived, and already
returned vehicles are rejected.

## Maintenance

`POST /vehicles/{id}/send-to-maintenance/` accepts required `reason` and
optional `notes`, `performed_at`, applicable readings, and photo
`media_file_ids`. It accepts only `available` or `damaged` vehicles without an
active loan/maintenance record.

`POST /vehicles/{id}/complete-maintenance/` accepts optional `notes`,
`performed_at`, applicable readings, and photo IDs. It closes the active record
and returns the vehicle to `damaged` when open damage remains, otherwise
`available`. Both actions return `{ "maintenance": ..., "vehicle": ... }`.

## Damage reports

| Method | Path | Description |
|---|---|---|
| GET | `/damage-reports/` | List damage reports |
| POST | `/damage-reports/` | Create damage report |
| GET | `/damage-reports/{id}/` | Retrieve damage report |
| PATCH | `/damage-reports/{id}/` | Update damage report |
| POST | `/damage-reports/{id}/resolve/` | Resolve damage report |

## Media

| Method | Path | Description |
|---|---|---|
| POST | `/media/` | Stage a photo or signature upload |
| GET | `/media/{id}/` | Retrieve media metadata |
| GET | `/media/{id}/download/` | Download file |
| POST | `/media/{id}/discard/` | Discard an uploader-owned staged file |

Upload request should use multipart form data with:

- `file`
- `media_type` (`photo` or `signature`)

The upload endpoint never accepts relationship fields. It returns a staged media
ID, which a vehicle/workflow request attaches through `media_file_ids` (or a
damage report's nested `media_file_ids`). Only the uploader can attach or
discard it, and a file can be attached once. PDF and import records are created
only by their dedicated server workflows.

Files are downloaded through authorized API endpoints. Import workbooks are
admin-only, read-only users see generated PDFs and attached photos, and
signature access is limited to operational/admin roles. Deployments must not
serve the media volume directly.

## Documents

| Method | Path | Description |
|---|---|---|
| GET | `/documents/` | List generated PDFs |
| GET | `/documents/{id}/` | Retrieve generated PDF metadata |
| GET | `/documents/{id}/download/` | Download generated PDF |
| GET | `/documents/register/` | Paginated completeness register |
| GET | `/documents/register-export-csv/` | Export the complete filtered register |
| POST | `/documents/retry/` | Retry one or up to 100 expected documents |

PDF generation endpoints accept JSON `{ "language": "de" }` or `{ "language": "en" }`.
If the same protocol/type/language already exists, the existing PDF metadata is
returned instead of overwriting the file.

Register filters: `status=generated|missing|failed|attention` (`attention`
combines missing and failed), `type`, `language`, `search`, and `plate`. Rows
include document/record/vehicle IDs, vehicle label, plate, performed time,
creator ID/label, language, status, failure reason, generated media ID, and a
retry descriptor. The CSV export applies the same filters without pagination.
A single retry is available to operations/admin; more than one `items[]` entry
is admin-only and audited.

PDFs are rendered only from immutable workflow snapshots. Authorized original
photos/signatures remain stored separately; validated evidence images are
compressed into the PDF with captions and SHA-256 hashes. Invalid, missing, or
oversized evidence and oversized PDFs fail safely and enter the register.

## Workflow drafts

| Method | Path | Description |
|---|---|---|
| GET/POST | `/workflow-drafts/` | List/resume or autosave/upsert |
| GET | `/workflow-drafts/{id}/` | Retrieve |
| POST | `/workflow-drafts/{id}/discard/` | Discard and safely clean orphaned staged media |

Workflow types are `check_in`, `loan_checkout`, `loan_return`,
`manufacturer_return`, `reservation`, and `maintenance`. Upsert identity is
`owner + workflow_type + scope_key`. The first save returns `201` and version
`1`; later saves require `expected_version` and return `200`. A stale version
returns `409 version_conflict` with the current draft in
`error.details.current`. Draft JSON is size-limited and cannot contain a
signature bitmap/data URI; signatures are staged media IDs. Non-admin users
see only their own active drafts. Draft saves never mutate vehicle status.

## Imports

Admin only.

| Method | Path | Description |
|---|---|---|
| POST | `/imports/vehicles/` | Upload and validate vehicle Excel file |
| POST | `/imports/{id}/remap/` | Revalidate with an explicit column mapping |
| POST | `/imports/{id}/commit/` | Commit validated import |
| POST | `/imports/{id}/exclude-rows/` | Set excluded row numbers and re-evaluate validity |
| GET | `/imports/{id}/` | Retrieve import result |
| GET | `/imports/` | List import jobs |
| GET | `/imports/vehicle-template/` | Download localized `.xlsx` template |
| GET | `/imports/{id}/errors-csv/` | Download row/field errors |
| GET | `/imports/{id}/generated-ids-csv/` | Download committed IDs |

Validation rows expose `present_fields`, field-level `diff` (`old`, `new`,
`changed`, `explicit_clear`), duplicate candidates, and supplier match/create
proposal. A missing column leaves an existing field unchanged; a present blank
cell explicitly clears a clearable field. Suppliers are never silently
created. `external_key` is the stable preferred update key; commit re-locks
matched records and verifies their validated identity/old values atomically.

## Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/summary/` | Status counts, active/overdue loans, returns, and recent activity |
| GET | `/dashboard/tasks/` | Operator task groups with direct IDs/actions/capabilities |
| GET | `/setup/readiness/` | Secret-free first-run checklist |

Task groups are `arrivals_awaiting_check_in`, `overdue_returns`,
`reservation_handovers`, `condition_attention`, `failed_documents`, and
`manufacturer_returns_due`; `limit` is capped at 100 per group.

Setup readiness reports effective role, app-admin capability, admin security
booleans/counts, active categories, supplier/manufacturer availability, users,
vehicles/announced arrivals, QR gaps, failed documents, and configured backup
status. It never returns credentials or secret configuration values.

## Audit log

Admin-only `GET /audit-logs/` and `GET /audit-logs/export-csv/` support
`action`, `entity_type`, `entity_id`, `actor`, `date_from`, and `date_to`.

## Permission matrix

| Area | Admin | Operations | Read-only |
|---|---:|---:|---:|
| Users | Full | Own profile | Own profile |
| Vehicles | Full | Read and execute workflows | Read |
| Categories | Full | Read | Read |
| Companies | Full | Read/create/update | Read |
| Drivers | Full | Read/create/update | Read |
| Check-in | Full | Create | Read |
| Loans | Full | Create/return | Read |
| Manufacturer check-out | Full | Create | Read |
| Media | Full | Upload/read | Read |
| PDF documents | Full | Generate/read | Read |
| Excel import | Full | No | No |
| Audit log | Read | No | No |
| Reservations/drafts/maintenance | Full | Execute own operational work | Read |
| Document retry | Full/bulk | Single retry | Read |

## Validation rules

Validation messages must be translatable in German and English when shown to end users.


- Only available vehicles can be loaned.
- Loan return requires an active loan and explicit condition outcome.
- Manufacturer return requires an active manufacturer/supplier recipient and
  accepts only available or damaged vehicles without an active loan.
- Odometer and operating hours must be non-negative.
- Category-applicable readings are required on check-in, loan checkout, return,
  and manufacturer return. Inapplicable readings are rejected.
- Readings must not decrease without the explicit, reasoned admin correction.
- Damage reports must include a description and may attach staged photos.
- Signatures are required for loan checkout; return signatures are policy-driven.
- Uploaded files must be restricted by content type, extension, and size.
- Excel imports validate all included rows before an atomic, locked commit.

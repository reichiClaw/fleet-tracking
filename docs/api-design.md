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

Passwords cannot be changed through `PATCH`. A user changing their own password
must send `current_password` and `new_password`; an application admin resetting
a non-superuser sends `new_password`.

## Vehicle categories

| Method | Path | Description |
|---|---|---|
| GET | `/vehicle-categories/` | List categories |
| POST | `/vehicle-categories/` | Create category |
| GET | `/vehicle-categories/{id}/` | Retrieve category |
| PATCH | `/vehicle-categories/{id}/` | Update category |
| POST | `/vehicle-categories/{id}/deactivate/` | Deactivate category |

## Vehicles

| Method | Path | Description |
|---|---|---|
| GET | `/vehicles/` | List vehicles |
| POST | `/vehicles/` | Create vehicle |
| GET | `/vehicles/{id}/` | Retrieve vehicle |
| PATCH | `/vehicles/{id}/` | Update vehicle |
| POST | `/vehicles/{id}/archive/` | Archive vehicle |
| GET | `/vehicles/{id}/history/` | Vehicle protocols and loans |
| GET | `/vehicles/{id}/media/` | Vehicle media |

Recommended filters:

- `status`
- `category`
- `manufacturer`
- `location`
- `is_available`
- `search`
- `expected_return_before`

## Companies

| Method | Path | Description |
|---|---|---|
| GET | `/companies/` | List companies |
| POST | `/companies/` | Create company |
| GET | `/companies/{id}/` | Retrieve company |
| PATCH | `/companies/{id}/` | Update company |
| POST | `/companies/{id}/deactivate/` | Deactivate company |

## Drivers

| Method | Path | Description |
|---|---|---|
| GET | `/drivers/` | List drivers |
| POST | `/drivers/` | Create driver |
| GET | `/drivers/{id}/` | Retrieve driver |
| PATCH | `/drivers/{id}/` | Update driver |
| POST | `/drivers/{id}/deactivate/` | Deactivate driver |

## Check-in workflow

| Method | Path | Description |
|---|---|---|
| POST | `/workflows/check-ins/` | Create check-in protocol |
| GET | `/workflows/check-ins/{id}/` | Retrieve check-in |
| POST | `/workflows/check-ins/{id}/generate-pdf/` | Generate protocol PDF |

Check-in completion is atomic. Clients should send an `Idempotency-Key` header
(maximum 128 characters) and reuse it when retrying the same request. Reusing a
key for a different actor, vehicle, or payload is rejected.

## Loan workflow

| Method | Path | Description |
|---|---|---|
| POST | `/loans/` | Create active loan and mark vehicle unavailable |
| GET | `/loans/` | List loans |
| GET | `/loans/{id}/` | Retrieve loan |
| POST | `/loans/{id}/return/` | Return active loan |
| POST | `/loans/{id}/generate-checkout-pdf/` | Generate loan checkout PDF |
| POST | `/loans/{id}/generate-return-pdf/` | Generate loan return PDF |

## Manufacturer check-out workflow

| Method | Path | Description |
|---|---|---|
| POST | `/workflows/manufacturer-checkouts/` | Create manufacturer check-out |
| GET | `/workflows/manufacturer-checkouts/{id}/` | Retrieve check-out |
| POST | `/workflows/manufacturer-checkouts/{id}/generate-pdf/` | Generate protocol PDF |

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

PDF generation endpoints accept JSON `{ "language": "de" }` or `{ "language": "en" }`.
If the same protocol/type/language already exists, the existing PDF metadata is
returned instead of overwriting the file.

## Imports

Admin only.

| Method | Path | Description |
|---|---|---|
| POST | `/imports/vehicles/` | Upload and validate vehicle Excel file |
| POST | `/imports/{id}/remap/` | Revalidate with an explicit column mapping |
| POST | `/imports/{id}/commit/` | Commit validated import |
| GET | `/imports/{id}/` | Retrieve import result |
| GET | `/imports/` | List import jobs |

## Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/summary/` | Status counts, active/overdue loans, returns, and recent activity |

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

## Validation rules

Validation messages must be translatable in German and English when shown to end users.


- Only available vehicles can be loaned.
- Loan return requires an active loan.
- Loaned vehicles cannot be checked out to manufacturers.
- Odometer and operating hours must be non-negative.
- Odometer and operating hours must not decrease without admin correction.
- At least one of odometer or operating hours should be required per vehicle,
  depending on vehicle category settings.
- Damage reports must include a description and may attach staged photos.
- Signatures are required for loan checkout unless configuration says otherwise.
- Uploaded files must be restricted by content type, extension, and size.
- Excel imports should validate all rows before committing changes.

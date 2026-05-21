# API Design

## Principles

- Base path: `/api/v1/`.
- JSON request and response bodies.
- Multipart upload endpoints for media.
- UUID identifiers.
- ISO 8601 timestamps.
- Paginated list endpoints.
- Role-based permissions.
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
  "type": "validation_error",
  "errors": {
    "field": ["Message"]
  }
}
```

### Permission error

```json
{
  "type": "permission_denied",
  "detail": "You do not have permission to perform this action."
}
```

## Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login/` | Authenticate user |
| POST | `/auth/logout/` | End session/token |
| GET | `/auth/me/` | Current user profile |

## Users

Admin only except own profile.

| Method | Path | Description |
|---|---|---|
| GET | `/users/` | List users |
| POST | `/users/` | Create user |
| GET | `/users/{id}/` | Retrieve user |
| PATCH | `/users/{id}/` | Update user |
| POST | `/users/{id}/deactivate/` | Deactivate user |

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

Completion can happen in the create request for MVP. If drafts are needed later,
split creation and completion into separate endpoints.

## Loan workflow

| Method | Path | Description |
|---|---|---|
| POST | `/loans/` | Create active loan and mark vehicle unavailable |
| GET | `/loans/` | List loans |
| GET | `/loans/{id}/` | Retrieve loan |
| POST | `/loans/{id}/return/` | Return active loan |
| POST | `/loans/{id}/cancel/` | Cancel active loan, admin only |
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
| POST | `/media/` | Upload file |
| GET | `/media/{id}/` | Retrieve media metadata |
| GET | `/media/{id}/download/` | Download file |
| DELETE | `/media/{id}/` | Delete file if allowed |

Upload request should use multipart form data with:

- `file`
- `media_type`
- `vehicle`
- optional `loan`
- optional `damage_report`
- optional `related_type`
- optional `related_id`

## Documents

| Method | Path | Description |
|---|---|---|
| GET | `/documents/` | List generated PDFs |
| GET | `/documents/{id}/download/` | Download generated PDF |

## Imports

Admin only.

| Method | Path | Description |
|---|---|---|
| POST | `/imports/vehicles/` | Upload and validate vehicle Excel file |
| POST | `/imports/{id}/commit/` | Commit validated import |
| GET | `/imports/{id}/` | Retrieve import result |
| GET | `/imports/` | List import jobs |

## Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/status-summary/` | Counts by status |
| GET | `/dashboard/overdue-loans/` | Loans past expected return |
| GET | `/dashboard/recent-activity/` | Recent workflow events |

## Permission matrix

| Area | Admin | Operations | Read-only |
|---|---:|---:|---:|
| Users | Full | Own profile | Own profile |
| Vehicles | Full | Read/update workflow fields | Read |
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

- Only available vehicles can be loaned.
- Loan return requires an active loan.
- Loaned vehicles cannot be checked out to manufacturers.
- Odometer and operating hours must be non-negative.
- Odometer and operating hours must not decrease without admin correction.
- At least one of odometer or operating hours should be required per vehicle,
  depending on vehicle category settings.
- Damage reports must include a description or photo.
- Signatures are required for loan checkout unless configuration says otherwise.
- Uploaded files must be restricted by content type, extension, and size.
- Excel imports should validate all rows before committing changes.

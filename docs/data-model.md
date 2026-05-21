# Data Model

Use UUID primary keys for all domain entities. Use `created_at` and
`updated_at` timestamps consistently.

## User

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| username | string | Unique login name |
| email | string | Optional but recommended |
| full_name | string | Display name |
| role | enum | `admin`, `operations`, `readonly` |
| is_active | boolean | Login allowed |
| last_login | datetime | Managed by auth system |

## VehicleCategory

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | string | Example: Steiger, Golf Car |
| description | text | Optional |
| is_active | boolean | Hide inactive categories in forms |

## Vehicle

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| internal_number | string | Unique fleet number |
| category_id | UUID | FK to VehicleCategory |
| manufacturer | string | Required |
| model | string | Required |
| serial_number | string | Optional unique where present |
| license_plate | string | Optional unique where present |
| status | enum | Current vehicle status |
| current_odometer_km | integer | Nullable for equipment without odometer |
| current_operating_hours | decimal | Nullable for vehicles without hour meter |
| current_location | string | Optional |
| notes | text | Optional |
| archived_at | datetime | Nullable |

## Company

Represents subcontractors, manufacturers, suppliers, and internal departments.

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | string | Required |
| company_type | enum | `subcontractor`, `manufacturer`, `supplier`, `internal` |
| contact_name | string | Optional |
| phone | string | Optional |
| email | string | Optional |
| address | text | Optional |
| notes | text | Optional |
| is_active | boolean | Defaults true |

## Driver

Fixed employees or regular drivers.

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| company_id | UUID | Optional FK to Company |
| first_name | string | Required |
| last_name | string | Required |
| phone | string | Optional |
| email | string | Optional |
| license_classes | string | Optional |
| notes | text | Optional |
| is_active | boolean | Defaults true |

## Loan

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| company_id | UUID | Optional FK to Company |
| driver_id | UUID | Optional FK to Driver |
| borrower_name | string | Required if no driver selected |
| borrower_phone | string | Required |
| expected_return_at | datetime | Required |
| actual_return_at | datetime | Nullable until returned |
| status | enum | `active`, `returned`, `cancelled` |
| checkout_odometer_km | integer | Nullable |
| checkout_operating_hours | decimal | Nullable |
| return_odometer_km | integer | Nullable |
| return_operating_hours | decimal | Nullable |
| checkout_notes | text | Optional |
| return_notes | text | Optional |
| created_by_id | UUID | User who created loan |
| returned_by_id | UUID | Nullable until returned |

## CheckInProtocol

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| performed_by_id | UUID | FK to User |
| performed_at | datetime | Required |
| supplier_company_id | UUID | Optional FK to Company |
| odometer_km | integer | Nullable |
| operating_hours | decimal | Nullable |
| condition_notes | text | Optional |
| pdf_media_id | UUID | Optional FK to MediaFile |

## ManufacturerCheckOutProtocol

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| performed_by_id | UUID | FK to User |
| performed_at | datetime | Required |
| recipient_company_id | UUID | Optional FK to Company |
| odometer_km | integer | Nullable |
| operating_hours | decimal | Nullable |
| condition_notes | text | Optional |
| pdf_media_id | UUID | Optional FK to MediaFile |

## DamageReport

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| loan_id | UUID | Optional FK to Loan |
| check_in_protocol_id | UUID | Optional FK |
| manufacturer_checkout_protocol_id | UUID | Optional FK |
| description | text | Required |
| severity | enum | `minor`, `major`, `critical`, `unknown` |
| discovered_at | datetime | Required |
| resolved_at | datetime | Nullable |
| created_by_id | UUID | FK to User |

## MediaFile

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | Optional FK |
| loan_id | UUID | Optional FK |
| damage_report_id | UUID | Optional FK |
| related_type | string | For flexible workflow attachment |
| related_id | UUID | Related record id |
| media_type | enum | `photo`, `signature`, `pdf`, `import` |
| original_filename | string | Metadata only |
| storage_key | string | Server-generated file path/key |
| content_type | string | MIME type |
| size_bytes | integer | Required |
| uploaded_by_id | UUID | FK to User |
| created_at | datetime | Required |

## ImportJob

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| import_type | enum | `vehicles`, `drivers`, `companies` |
| source_media_id | UUID | FK to MediaFile |
| status | enum | `uploaded`, `validated`, `failed`, `committed` |
| row_count | integer | Optional |
| error_count | integer | Optional |
| result | json | Row-level messages |
| created_by_id | UUID | FK to User |
| committed_at | datetime | Nullable |

## AuditLog

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| actor_id | UUID | Nullable for system actions |
| action | string | Machine-readable action |
| entity_type | string | Example: `vehicle`, `loan` |
| entity_id | UUID | Related entity |
| before | json | Previous values where relevant |
| after | json | New values where relevant |
| ip_address | string | Optional |
| user_agent | text | Optional |
| created_at | datetime | Immutable |

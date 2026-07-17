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
| must_change_password | boolean | Temporary/reset password must be replaced |
| is_active | boolean | Login allowed |
| last_login | datetime | Managed by auth system |

Django superusers are treated as application admins by permission and
capability checks even when their stored `role` is different.

## VehicleCategory

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | string | Example: Steiger, Golf Car |
| description | text | Optional |
| meter_mode | enum | `odometer`, `hours`, `both`, or `none`; default `both` |
| is_active | boolean | Hide inactive categories in forms |

## Vehicle

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| internal_number | string | Unique fleet number |
| external_key | string | Optional stable unique source-system key |
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
| archived_by_id | UUID | User performing audited archive |
| archive_reason | text | Required for a new archive |
| archive_previous_status | enum | Safe correction target retained on archive |

Manual and imported records always begin as `announced`. Operational status is
workflow-owned; only the explicit admin correction service can make a reasoned,
safe correction.

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
| return_condition_outcome | enum | `fit`, `new_damage`, or `maintenance` |
| checkout_pdf_language | string | `de` or `en`, nullable until PDF is generated |
| return_pdf_language | string | `de` or `en`, nullable until PDF is generated |
| created_by_id | UUID | User who created loan |
| returned_by_id | UUID | Nullable until returned |

The related reservation is available through the reverse one-to-one
`reservation` relation. Checkout/return snapshots and generated document links
are write-once evidence.

## Reservation

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | Reserved vehicle |
| start_at / end_at | datetime | Non-empty reservation interval |
| driver_id | UUID | Optional fixed-driver party |
| company_id | UUID | Optional company/contact party |
| reserved_for | string | Stored display/contact name |
| manual_phone | string | Stored party phone |
| notes | text | Optional |
| status | enum | `active`, `cancelled`, `fulfilled`, `no_show` |
| snapshot | json | Immutable party snapshot |
| fulfilled_at / fulfilled_by_id | datetime / UUID | Set only on checkout conversion |
| loan_id | UUID | Unique linked loan for a fulfilled reservation |
| created_by_id | UUID | Creator |

Exactly one party mode is selected: driver, company/contact, or manual
name/phone. Active overlapping intervals for one vehicle are serialized by a
vehicle row lock.

## CheckInProtocol

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| performed_by_id | UUID | FK to User |
| performed_at | datetime | Required |
| supplier_company_id | UUID | Required active supplier/manufacturer in API workflows |
| odometer_km | integer | Nullable |
| operating_hours | decimal | Nullable |
| condition_notes | text | Optional |
| pdf_media_id | UUID | Optional FK to MediaFile |
| pdf_language | string | `de` or `en`, nullable until PDF is generated |

## ManufacturerCheckOutProtocol

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | FK to Vehicle |
| performed_by_id | UUID | FK to User |
| performed_at | datetime | Required |
| recipient_company_id | UUID | Required active manufacturer/supplier in API workflows |
| odometer_km | integer | Nullable |
| operating_hours | decimal | Nullable |
| condition_notes | text | Optional |
| pdf_media_id | UUID | Optional FK to MediaFile |
| pdf_language | string | `de` or `en`, nullable until PDF is generated |

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
| resolved_by_id | UUID | Nullable until resolved |
| resolution_notes | text | Immutable resolution evidence |
| created_by_id | UUID | FK to User |

Resolving the final open damage restores `available` only if no active loan,
maintenance interval, or manufacturer-return state prevents it.

## MaintenanceRecord

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| vehicle_id | UUID | Protected FK |
| reason / start_notes | text | Immutable start evidence |
| started_at / started_by_id | datetime / UUID | Immutable |
| start_odometer_km / start_operating_hours | number | Optional applicable readings |
| start_snapshot | json | Immutable snapshot including media hashes |
| status | enum | `active`, `completed` |
| completion_notes | text | Completion evidence |
| completed_at / completed_by_id | datetime / UUID | Required when completed |
| completion_odometer_km / completion_operating_hours | number | Optional applicable readings |
| completion_snapshot | json | Immutable completion snapshot |

A conditional unique constraint permits only one active maintenance record per
vehicle.

## WorkflowDraft

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| owner_id | UUID | Draft owner |
| workflow_type | enum | Check-in, checkout, return, manufacturer return, reservation, maintenance |
| scope_key | string | Client-stable wizard/object scope |
| object_id | UUID | Optional related domain object |
| form_data | json | Size-limited, non-secret form state |
| staged_media_ids | json array | Owner's staged photo/signature IDs |
| step | integer | Current wizard step |
| version | integer | Optimistic-lock version |
| expires_at | datetime | Cleanup deadline |

`owner + workflow_type + scope_key` is unique. Drafts do not own or mutate
vehicle status. Signature bitmap/data URI content is prohibited in JSON.

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
| content_sha256 | string | Required immutable content digest |
| language | string | `de`/`en` only for generated PDFs |
| is_generated | boolean | Server-generated document marker |
| attached_at | datetime | Nullable while staged |
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

Vehicle import results persist header/presence information, explicit-clear
semantics, old/new field diffs, exclusions, duplicate candidates, supplier
proposals, validation fingerprints, and committed generated IDs.

## Translation resources

Translation resources are primarily frontend files, not database tables. Store
stable codes in the database, such as status codes and workflow types, and
translate them at the presentation layer. Generated PDF records should store the
language code used at generation time.

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

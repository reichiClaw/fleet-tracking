# Requirements

## Purpose

Build a web application for managing a vehicle and equipment pool. Newly
delivered vehicles are checked in with a protocol. Vehicles in the pool can be
loaned to subcontractors or fixed internal drivers. Returned vehicles are
checked back into the pool. Vehicles can also be checked out to the
manufacturer or supplier.

The application must support vehicle categories such as:

- Steiger
- Golf Car
- Loader
- Telehandler
- Lifting platform
- Other configurable categories

## Roles

### Admin

Admins can:

- Manage users and roles.
- Create and edit vehicles.
- Import vehicles from Excel.
- Manage categories.
- Manage fixed drivers/employees.
- Manage subcontractor/company master data.
- View all protocols, media, and audit logs.
- Archive vehicles.

### Operations user

Operations users can:

- Check vehicles in after delivery.
- Loan vehicles from the pool.
- Return loaned vehicles.
- Check vehicles out to manufacturers/suppliers.
- Capture readings, damage notes, photos, and signatures.
- View vehicle pool and status overview.

### Read-only user, optional

Read-only users can:

- View vehicle status and history.
- Download protocols if permitted.
- Not create or change records.

## Vehicle statuses

Recommended status values:

| Status | Meaning |
|---|---|
| `announced` | Vehicle exists in planning/import data but has not arrived. |
| `checked_in` | Vehicle was accepted after delivery. |
| `available` | Vehicle is in the pool and can be loaned. |
| `reserved` | Vehicle is planned for a future loan. Optional for MVP. |
| `loaned` | Vehicle is currently loaned and unavailable. |
| `maintenance` | Vehicle is unavailable for inspection or repair. |
| `damaged` | Vehicle has unresolved damage. |
| `manufacturer_checkout` | Vehicle has been returned to manufacturer/supplier. |
| `archived` | Vehicle is no longer actively managed. |

## Allowed transitions

- `announced` -> `checked_in`
- `checked_in` -> `available`
- `available` -> `loaned`
- `loaned` -> `available`
- `available` -> `maintenance`
- `maintenance` -> `available`
- `available` -> `damaged`
- `damaged` -> `maintenance`
- `damaged` -> `available`
- `available` -> `manufacturer_checkout`
- `manufacturer_checkout` -> `archived`

## Core workflows

### Vehicle check-in after delivery

Captured data:

- Vehicle identity and category.
- Manufacturer/supplier.
- Delivery date/time.
- Odometer reading, if applicable.
- Operating hours, if applicable.
- General condition notes.
- Visible damages.
- Photos of vehicle and damage.
- Optional signature.
- User who performed the check-in.

Result:

- Check-in protocol is stored.
- PDF protocol can be generated.
- Vehicle enters the pool and becomes available unless marked damaged or in
  maintenance.

### Vehicle loan checkout

Captured data:

- Vehicle.
- Subcontractor/company or fixed driver.
- Borrower name.
- Phone number.
- Expected return date/time or approximate time span.
- Odometer reading.
- Operating hours.
- Existing and new damage notes.
- Photos.
- Borrower signature.
- User who performed the loan.

Result:

- Loan record is created.
- Vehicle becomes unavailable with status `loaned`.
- Vehicle pool shows borrower and expected return.

### Vehicle loan return

Captured data:

- Active loan.
- Actual return date/time.
- Return odometer reading.
- Return operating hours.
- Damage notes.
- Photos.
- Optional return signature.
- User who performed the return.

Result:

- Active loan is closed.
- Vehicle returns to `available`, `damaged`, or `maintenance`.
- Usage difference can be calculated from readings.

### Manufacturer/supplier check-out

Captured data:

- Vehicle.
- Manufacturer/supplier receiver.
- Return date/time.
- Odometer reading.
- Operating hours.
- Damage notes.
- Photos.
- Optional signature.
- User who performed the check-out.

Result:

- Manufacturer check-out protocol is stored.
- Vehicle status becomes `manufacturer_checkout`.
- Vehicle is hidden from the active pool by default.

## User stories and acceptance criteria

### Check in a delivered vehicle

As an operations user, I want to check in a delivered vehicle so that it appears
in the vehicle pool.

Acceptance criteria:

- The user can select an existing announced/imported vehicle or create one.
- Odometer and operating hours can be captured where applicable.
- Damage notes and photos can be attached.
- Completing the workflow updates the vehicle status.
- The vehicle history shows the check-in record.

### Loan an available vehicle

As an operations user, I want to loan an available vehicle so that the borrower
and condition are documented.

Acceptance criteria:

- Only available vehicles can be loaned.
- Borrower data can be entered manually or prefilled from a fixed driver.
- Expected return time is captured.
- Photos and a signature can be stored.
- Completing the workflow marks the vehicle unavailable.

### Return a loaned vehicle

As an operations user, I want to return a loaned vehicle so that availability
and condition are updated.

Acceptance criteria:

- Only vehicles with an active loan can be returned.
- Return readings cannot be lower than loan checkout readings unless an admin
  correction is used.
- New damage can be documented with photos.
- Completing the workflow closes the loan.

### Check out a vehicle to manufacturer

As an operations user, I want to return a vehicle to its manufacturer or
supplier so that it is removed from the active pool.

Acceptance criteria:

- Loaned vehicles cannot be checked out to manufacturers.
- Readings, damage notes, and photos are captured.
- The final protocol is stored.
- The vehicle no longer appears as available.

### Import vehicles from Excel

As an admin, I want to import vehicles from Excel so that setup and updates are
fast.

Acceptance criteria:

- Required columns are documented.
- Invalid rows show row-level errors.
- Valid rows create or update vehicles according to import rules.
- Import results are auditable.

## MVP scope

The MVP includes:

- Authentication.
- Admin and operations roles.
- Vehicle category management.
- Vehicle CRUD.
- Excel vehicle import.
- Driver and company master data.
- Vehicle pool and status overview.
- Check-in workflow.
- Loan checkout workflow.
- Loan return workflow.
- Manufacturer check-out workflow.
- Photo uploads.
- Signature capture.
- PDF protocol generation.
- Audit log for important changes.
- Docker Compose deployment with persistent database and media storage.

## Non-goals for MVP

- GPS tracking.
- Telematics integration.
- Billing.
- Native mobile apps.
- Full offline-first mode.
- Predictive maintenance.
- Multi-tenant SaaS billing.
- Direct manufacturer API integrations.

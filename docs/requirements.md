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


## Language support

The application must be fully usable in German and English. German and English
translations are required for the user interface, workflow labels, validation
messages, status labels, PDF protocols, and import result messages.

Implementation agents must not hard-code user-facing text directly in frontend
components or PDF templates. User-facing text should be stored in translation
resources and maintained for both `de` and `en`. See `docs/i18n.md` for the
translation strategy and terminology.

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
- Archive manufacturer-returned vehicles with a reason and perform audited safe
  corrections.

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
- `checked_in` -> `available` / `damaged` / `maintenance` according to the
  explicit condition outcome
- `available` -> `loaned`
- `loaned` -> `available` / `damaged` / `maintenance` on return
- `available` -> `maintenance`
- `maintenance` -> `available` / `damaged` on completion
- `available` -> `damaged`
- `damaged` -> `maintenance`
- `damaged` -> `available`
- `available` or `damaged` -> `manufacturer_checkout`
- `manufacturer_checkout` -> `archived`

These are domain transitions, not generic edit permissions. API clients cannot
set `status` through vehicle create/update. Manual and imported records always
start as `announced`; workflows own operational transitions. A reasoned admin
correction is a separate, constrained, audited action.

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

The supplier is required and must be an active supplier or manufacturer.
Category meter mode (`odometer`, `hours`, `both`, `none`) determines exactly
which readings are required; inapplicable readings are rejected.

Result:

- Check-in protocol is stored.
- PDF protocol can be generated.
- Vehicle enters the pool and becomes available unless marked damaged or in
  maintenance.
- Master-data creation plus check-in can be completed as one atomic,
  idempotent operation, or an announced record can be created first.

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
- Optional active reservation to fulfill.

Result:

- Loan record is created.
- Vehicle becomes unavailable with status `loaned`.
- Vehicle pool shows borrower and expected return.
- A selected reservation is validated and atomically linked/fulfilled. Another
  current or near-term reservation blocks checkout.

### Vehicle loan return

Captured data:

- Active loan.
- Explicit condition outcome: `fit`, `new_damage`, or `maintenance`.
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
- Open pre-existing damage prevents an unsafe return to `available`.

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

The recipient is required and must be an active manufacturer or supplier.

Result:

- Manufacturer check-out protocol is stored.
- Vehicle status becomes `manufacturer_checkout`.
- Vehicle is hidden from the active pool by default.

Eligibility is intentionally limited to `available` or `damaged` vehicles with
no active loan. Vehicles in maintenance must complete that workflow first.

### Reservation handover

Reservations support a fixed driver, company/contact, or manual name/phone.
Party identity is snapshotted. Active reservations can be edited, cancelled, or
marked no-show after start. Loan checkout with `reservation_id` locks both
records and atomically links the resulting loan and marks the reservation
fulfilled.

### Maintenance recovery

Sending a vehicle to maintenance records a required reason, optional readings
and photos, immutable start snapshot, actor, and timestamp. Completion records
completion evidence and restores `available` only when no open damage remains;
otherwise the vehicle becomes `damaged`.

### Resumable workflows

Check-in, loan checkout/return, manufacturer return, reservation, and
maintenance wizards may autosave owner-scoped drafts with optimistic versions,
step, expiry, non-secret JSON, and staged media IDs. Drafts never mutate domain
status. Signature bitmaps are uploaded as media and never stored in draft JSON.

Draft recovery must distinguish resume, explicit discard, successful completion,
offline save failure, and optimistic-version conflict. Staged media remains
available while a draft can be resumed and is removed only after confirmed
discard, successful attachment/completion, or expiry cleanup.

## Operational reliability and scale

- Read requests have a finite timeout and may retry once only when the operation
  is safe (`GET`) and the failure is transient. Writes are never retried
  automatically because their outcome may be ambiguous.
- Cancelled stale requests do not trigger the offline banner. Lost connectivity
  and expired sessions are reported globally while the application shell stays
  available for recovery.
- Large operational collections use server-side filtering, pagination, and
  typeahead. Fully loading a collection is limited to explicitly bounded
  reference data such as vehicle categories.
- The Tasks view and navigation badge surface overdue loans, announced arrivals,
  reservation handovers, condition/maintenance work, manufacturer due dates,
  and failed or missing protocol documents.
- Workflow completion receipts show protocol generation state. Missing or
  failed PDFs link to the document register, where authorized users can retry
  generation without repeating the domain workflow.
- Generated protocol evidence includes authorized stored signatures and a
  contact sheet of attached photos. Downloads always pass through the
  authenticated media endpoint.

## User stories and acceptance criteria

### Check in a delivered vehicle

As an operations user, I want to check in a delivered vehicle so that it appears
in the vehicle pool.

Acceptance criteria:

- The user can select an existing announced/imported vehicle or create one.
- New/manual/imported master data cannot bypass check-in into `available`.
- Supplier, condition outcome, and category-applicable readings are required.
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
- Current/near-term reservations block conflicting checkout; selecting the
  matching reservation fulfills and links it atomically.

### Return a loaned vehicle

As an operations user, I want to return a loaned vehicle so that availability
and condition are updated.

Acceptance criteria:

- Only vehicles with an active loan can be returned.
- A condition outcome is explicit; there is no default to `available`.
- Return readings cannot be lower than loan checkout readings unless an admin
  correction is used.
- New damage can be documented with photos.
- Completing the workflow closes the loan.
- Existing unresolved damage is considered when deriving final status.

### Check out a vehicle to manufacturer

As an operations user, I want to return a vehicle to its manufacturer or
supplier so that it is removed from the active pool.

Acceptance criteria:

- Loaned vehicles cannot be checked out to manufacturers.
- Only available or damaged vehicles without an active loan are eligible.
- An active manufacturer/supplier recipient and applicable readings are
  required; damage notes and photos can be captured.
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
- Missing columns differ from explicit blank clears; rows expose old/new diffs,
  can be excluded, and use a stable `external_key` where provided.
- Supplier matches/proposals are shown but no supplier is silently created.

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
- German and English localization for UI, validation messages, statuses, and PDFs.
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

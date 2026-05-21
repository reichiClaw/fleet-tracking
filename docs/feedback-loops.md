# Feedback Loops

Use these checkpoints to keep implementation aligned with real operational
needs.

## Feedback loop 1: Domain workflow validation

Goal: confirm the real-life handover and loan processes.

Questions:

- Are there multiple locations or yards?
- Are vehicles owned, rented, or temporarily supplied?
- Can damaged vehicles still be loaned?
- Is a signature mandatory for every loan?
- Should check-in also require a supplier signature?
- Are reservations needed for future loans?
- Which categories use odometer, operating hours, or both?
- Are there legal requirements for immutable protocols?

Output:

- Updated workflow fields.
- Required/optional field matrix.
- Confirmed status labels in German and English.

## Feedback loop 2: Excel import sample

Goal: validate setup data and import behavior.

Actions:

- Collect a real sample Excel file.
- Identify required columns.
- Decide whether existing vehicles are updated, skipped, or rejected.
- Confirm unique identifiers: internal number, serial number, license plate.

Output:

- Import template.
- Row validation rules.
- Example success/error report.

## Feedback loop 3: UI prototype review

Goal: ensure field workers can use the app on tablets or phones.

Review screens:

- Dashboard.
- Vehicle pool.
- Vehicle detail.
- Check-in wizard.
- Loan wizard.
- Return wizard.
- Manufacturer check-out wizard.
- Photo upload.
- Signature capture.

Output:

- Adjusted form order.
- Confirmed required fields.
- Confirmed German and English wording for operational users.
- Confirmed mobile layout.

## Feedback loop 4: MVP dry run

Goal: test end-to-end behavior with realistic data.

Scenarios:

- Import vehicles.
- Check in a vehicle.
- Loan it to a subcontractor.
- Return it with no damage.
- Loan another vehicle to a fixed driver.
- Return it with new damage and photos.
- Check a vehicle out to manufacturer.
- Download German and English PDFs.
- Review vehicle history.

Output:

- Bugs and UX friction points.
- Missing operational fields.
- Missing or unclear translations.
- Final MVP acceptance list.

## Feedback loop 5: Deployment and operations review

Goal: confirm the app can run safely on the Proxmox server.

Checks:

- Docker Compose restart preserves database and media.
- Backup and restore work.
- HTTPS is configured.
- PostgreSQL is not publicly exposed.
- Upload sizes are acceptable.
- Disk usage is monitored.
- Admin password and secrets are secure.

Output:

- Deployment checklist sign-off.
- Backup schedule.
- Restore runbook.

# Agent Task: Media, Signatures, and PDFs

## Goal

Implement file upload, signature storage, damage photos, and PDF protocol
generation.

## Read first

- `docs/requirements.md`
- `docs/architecture.md`
- `docs/api-design.md`
- `docs/data-model.md`

## Scope

- Photo uploads.
- Signature uploads.
- Media metadata.
- Secure download endpoints.
- PDF generation for:
  - Check-in.
  - Loan checkout.
  - Loan return.
  - Manufacturer check-out.
- Backend tests for upload and PDF generation.
- Frontend integration points for file upload and signature capture.

## PDF content

Each PDF should include:

- Protocol number.
- Vehicle data.
- Workflow type.
- Date/time.
- Performing user.
- Readings.
- Borrower or receiver data where relevant.
- Damage notes.
- Photos where practical.
- Signature where relevant.

## Acceptance criteria

- Files are stored in a Docker media volume.
- Unsafe upload types are rejected.
- Generated PDFs are linked to the correct workflow.
- PDFs are treated as immutable after generation.

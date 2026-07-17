"""Localized immutable PDF protocol generation for workflows."""

from __future__ import annotations

from io import BytesIO
import hashlib
from typing import Any
from xml.sax.saxutils import escape

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework import serializers

from damages.models import DamageReport, DamageWorkflowPhase
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import cleanup_storage_file, create_media_file_from_bytes
from vehicles.models import VehicleStatus
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol

CHECK_IN_DOCUMENT = "check_in_protocol_pdf"
LOAN_CHECKOUT_DOCUMENT = "loan_checkout_pdf"
LOAN_RETURN_DOCUMENT = "loan_return_pdf"
MANUFACTURER_CHECKOUT_DOCUMENT = "manufacturer_checkout_protocol_pdf"
SUPPORTED_PDF_LANGUAGES = {"de", "en"}

_T = {
    "en": {
        "check_in_title": "Vehicle Check-In Protocol",
        "loan_checkout_title": "Vehicle Loan Protocol",
        "loan_return_title": "Vehicle Return Protocol",
        "manufacturer_checkout_title": "Manufacturer Check-Out Protocol",
        "protocol_number": "Protocol number",
        "language": "Language",
        "language_name": "English",
        "workflow_type": "Workflow type",
        "date_time": "Date/time",
        "user": "User",
        "vehicle": "Vehicle",
        "internal_number": "Internal number",
        "manufacturer_model": "Manufacturer/model",
        "serial_number": "Serial number",
        "license_plate": "License plate",
        "status": "Status",
        "readings": "Readings",
        "odometer": "Odometer (km)",
        "operating_hours": "Operating hours",
        "supplier": "Supplier",
        "recipient": "Recipient",
        "borrower": "Borrower",
        "borrower_phone": "Borrower phone",
        "company": "Company",
        "expected_return": "Expected return",
        "actual_return": "Actual return",
        "notes": "Notes",
        "damage_notes": "Damage notes",
        "signature_reference": "Signature reference",
        "signature_evidence": "Signature evidence",
        "photo_evidence": "Photo evidence",
        "content_hash": "SHA-256",
        "condition_outcome": "Condition outcome",
        "fit": "Fit for service",
        "new_damage": "New damage",
        "maintenance_required": "Maintenance required",
        "no_damage": "No damage notes recorded.",
        "not_available": "Not available",
        "check_in": "Check-in",
        "loan_checkout": "Loan checkout",
        "loan_return": "Loan return",
        "manufacturer_checkout": "Manufacturer check-out",
        "announced": "Announced",
        "checked_in": "Checked in",
        "available": "Available",
        "reserved": "Reserved",
        "loaned": "Loaned",
        "maintenance": "Maintenance",
        "damaged": "Damaged",
        "manufacturer_checkout_status": "Checked out to manufacturer",
        "archived": "Archived",
        "minor": "Minor",
        "major": "Major",
        "critical": "Critical",
        "unknown": "Unknown",
    },
    "de": {
        "check_in_title": "Fahrzeug-\u00dcbernahmeprotokoll",
        "loan_checkout_title": "Fahrzeug-Ausleihprotokoll",
        "loan_return_title": "Fahrzeug-R\u00fcckgabeprotokoll",
        "manufacturer_checkout_title": "Hersteller-R\u00fcckgabeprotokoll",
        "protocol_number": "Protokollnummer",
        "language": "Sprache",
        "language_name": "Deutsch",
        "workflow_type": "Workflow-Typ",
        "date_time": "Datum/Uhrzeit",
        "user": "Benutzer",
        "vehicle": "Fahrzeug",
        "internal_number": "Interne Nummer",
        "manufacturer_model": "Hersteller/Modell",
        "serial_number": "Seriennummer",
        "license_plate": "Kennzeichen",
        "status": "Status",
        "readings": "Z\u00e4hlerst\u00e4nde",
        "odometer": "Kilometerstand (km)",
        "operating_hours": "Betriebsstunden",
        "supplier": "Lieferant",
        "recipient": "Empf\u00e4nger",
        "borrower": "Ausleiher",
        "borrower_phone": "Telefon Ausleiher",
        "company": "Firma",
        "expected_return": "Erwartete R\u00fcckgabe",
        "actual_return": "Tats\u00e4chliche R\u00fcckgabe",
        "notes": "Notizen",
        "damage_notes": "Schadensnotizen",
        "signature_reference": "Unterschriftsreferenz",
        "signature_evidence": "Unterschriftsnachweis",
        "photo_evidence": "Fotodokumentation",
        "content_hash": "SHA-256",
        "condition_outcome": "Zustandsergebnis",
        "fit": "Einsatzbereit",
        "new_damage": "Neuer Schaden",
        "maintenance_required": "Wartung erforderlich",
        "no_damage": "Keine Schadensnotizen erfasst.",
        "not_available": "Nicht verf\u00fcgbar",
        "check_in": "Einchecken / \u00dcbernahme",
        "loan_checkout": "Fahrzeug ausleihen",
        "loan_return": "Fahrzeug zur\u00fcckgeben",
        "manufacturer_checkout": "R\u00fcckgabe an Hersteller",
        "announced": "Angek\u00fcndigt",
        "checked_in": "Eingecheckt",
        "available": "Verf\u00fcgbar",
        "reserved": "Reserviert",
        "loaned": "Ausgeliehen",
        "maintenance": "Wartung",
        "damaged": "Besch\u00e4digt",
        "manufacturer_checkout_status": "An Hersteller ausgecheckt",
        "archived": "Archiviert",
        "minor": "Gering",
        "major": "Schwer",
        "critical": "Kritisch",
        "unknown": "Unbekannt",
    },
}


def generate_check_in_pdf(
    *,
    protocol: CheckInProtocol,
    actor,
    language: str | None = None,
    request_meta: dict[str, str] | None = None,
) -> MediaFile:
    return _generate_document(
        document_type=CHECK_IN_DOCUMENT,
        record=protocol,
        actor=actor,
        language=language,
        title_key="check_in_title",
        workflow_key="check_in",
        snapshot_field="snapshot",
        link_fields=("pdf_media", "pdf_language"),
        request_meta=request_meta,
    )


def generate_loan_checkout_pdf(
    *, loan: Loan, actor, language: str | None = None, request_meta: dict[str, str] | None = None
) -> MediaFile:
    return _generate_document(
        document_type=LOAN_CHECKOUT_DOCUMENT,
        record=loan,
        actor=actor,
        language=language,
        title_key="loan_checkout_title",
        workflow_key="loan_checkout",
        snapshot_field="checkout_snapshot",
        link_fields=("checkout_pdf_media", "checkout_pdf_language"),
        request_meta=request_meta,
    )


def generate_loan_return_pdf(
    *, loan: Loan, actor, language: str | None = None, request_meta: dict[str, str] | None = None
) -> MediaFile:
    if loan.actual_return_at is None:
        raise serializers.ValidationError({"loan": _("Loan return PDF requires a returned loan.")})
    return _generate_document(
        document_type=LOAN_RETURN_DOCUMENT,
        record=loan,
        actor=actor,
        language=language,
        title_key="loan_return_title",
        workflow_key="loan_return",
        snapshot_field="return_snapshot",
        link_fields=("return_pdf_media", "return_pdf_language"),
        request_meta=request_meta,
    )


def generate_manufacturer_checkout_pdf(
    *,
    protocol: ManufacturerCheckOutProtocol,
    actor,
    language: str | None = None,
    request_meta: dict[str, str] | None = None,
) -> MediaFile:
    return _generate_document(
        document_type=MANUFACTURER_CHECKOUT_DOCUMENT,
        record=protocol,
        actor=actor,
        language=language,
        title_key="manufacturer_checkout_title",
        workflow_key="manufacturer_checkout",
        snapshot_field="snapshot",
        link_fields=("pdf_media", "pdf_language"),
        request_meta=request_meta,
    )


@transaction.atomic
def _generate_document(
    *,
    document_type: str,
    record,
    actor,
    language: str | None,
    title_key: str,
    workflow_key: str,
    snapshot_field: str,
    link_fields: tuple[str, str],
    request_meta: dict[str, str] | None,
) -> MediaFile:
    record = type(record).objects.select_for_update().get(pk=record.pk)
    language_code = _language(language)
    snapshot = getattr(record, snapshot_field)
    if not snapshot:
        snapshot = _legacy_snapshot(document_type=document_type, record=record)
        setattr(record, snapshot_field, snapshot)
        record.save(update_fields=[snapshot_field, "updated_at"])
    existing = _existing_document(document_type=document_type, record=record, language=language_code)
    if existing is not None:
        _link_record_if_empty(record=record, media=existing, language=language_code, link_fields=link_fields)
        return existing

    labels = _T[language_code]
    protocol_number = _protocol_number(document_type, record)
    pdf_bytes = _render_pdf(
        labels=labels,
        title=labels[title_key],
        protocol_number=protocol_number,
        language=language_code,
        workflow_type=labels[workflow_key],
        snapshot=snapshot,
    )
    max_pdf_size = int(settings.MAX_PDF_SIZE_MB) * 1024 * 1024
    if not pdf_bytes.startswith(b"%PDF") or len(pdf_bytes) > max_pdf_size:
        raise serializers.ValidationError(
            {"document": _("Generated PDF failed validation or exceeds the configured size limit.")}
        )
    vehicle_id = snapshot.get("vehicle", {}).get("id")
    from vehicles.models import Vehicle

    vehicle = Vehicle.objects.get(pk=vehicle_id)
    media = create_media_file_from_bytes(
        content=pdf_bytes,
        actor=actor,
        media_type=MediaType.PDF,
        filename=f"{protocol_number}-{language_code}.pdf".lower(),
        content_type="application/pdf",
        vehicle=vehicle,
        loan=record if isinstance(record, Loan) else None,
        related_type=document_type,
        related_id=record.id,
        language=language_code,
        request_meta=request_meta,
    )
    try:
        _link_record_if_empty(record=record, media=media, language=language_code, link_fields=link_fields)
    except Exception:
        # Database rollback cannot undo a write to filesystem/SFTP/S3 storage.
        # Remove the object before letting the atomic block roll back its row.
        cleanup_storage_file(media.storage_key)
        raise
    return media


def _existing_document(*, document_type: str, record, language: str) -> MediaFile | None:
    media = (
        MediaFile.objects.filter(
            media_type=MediaType.PDF,
            is_generated=True,
            related_type=document_type,
            related_id=record.id,
            language=language,
        )
        .order_by("created_at")
        .first()
    )
    if media is not None:
        if not default_storage.exists(media.storage_key):
            raise serializers.ValidationError({"document": _("The immutable PDF file is missing from storage.")})
        return media
    return None


def _link_record_if_empty(*, record, media: MediaFile, language: str, link_fields: tuple[str, str]) -> None:
    media_field, language_field = link_fields
    if getattr(record, f"{media_field}_id", None):
        return
    setattr(record, media_field, media)
    setattr(record, language_field, language)
    record.save(update_fields=[media_field, language_field, "updated_at"])


def _render_pdf(
    *,
    labels: dict[str, str],
    title: str,
    protocol_number: str,
    language: str,
    workflow_type: str,
    snapshot: dict[str, Any],
) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, title=title)
    styles = getSampleStyleSheet()
    story = [Paragraph(_p(title), styles["Title"]), Spacer(1, 12)]

    performed_by = snapshot.get("performed_by") or {}
    rows = [
        (labels["protocol_number"], protocol_number),
        (labels["language"], labels["language_name"]),
        (labels["workflow_type"], workflow_type),
        (labels["date_time"], _format_datetime(snapshot.get("performed_at"))),
        (labels["user"], performed_by.get("display_name") or performed_by.get("username", "")),
    ]
    story.extend(_section(labels["workflow_type"], rows, styles))

    vehicle = snapshot.get("vehicle") or {}
    vehicle_rows = [
        (labels["internal_number"], vehicle.get("internal_number", "")),
        (
            labels["manufacturer_model"],
            f"{vehicle.get('manufacturer', '')} {vehicle.get('model', '')}".strip(),
        ),
        (labels["serial_number"], vehicle.get("serial_number", "")),
        (labels["license_plate"], vehicle.get("license_plate", "")),
        (labels["status"], _status_label(vehicle.get("status", ""), labels)),
    ]
    story.extend(_section(labels["vehicle"], vehicle_rows, styles))

    readings = snapshot.get("readings") or {}
    reading_rows = [
        (labels["odometer"], _value(readings.get("odometer_km"), labels)),
        (labels["operating_hours"], _value(readings.get("operating_hours"), labels)),
    ]
    story.extend(_section(labels["readings"], reading_rows, styles))

    party = snapshot.get("party")
    if party:
        party_label = "supplier" if snapshot.get("workflow_type") == "check_in" else "recipient"
        story.extend(_section(labels[party_label], [(labels[party_label], party.get("name", ""))], styles))
    borrower = snapshot.get("borrower")
    if borrower is not None:
        story.extend(_section(labels["borrower"], _borrower_snapshot_rows(borrower, labels), styles))

    story.extend(
        _section(labels["notes"], [(labels["notes"], snapshot.get("notes") or labels["not_available"])], styles)
    )
    if snapshot.get("condition_outcome"):
        outcome = snapshot["condition_outcome"]
        outcome_key = "maintenance_required" if outcome == "maintenance" else outcome
        story.extend(
            _section(
                labels["condition_outcome"],
                [(labels["condition_outcome"], labels.get(outcome_key, outcome))],
                styles,
            )
        )
    damage_rows = _damage_snapshot_rows(snapshot.get("damages") or [], labels)
    story.extend(_section(labels["damage_notes"], damage_rows, styles))
    signatures = snapshot.get("signatures") or []
    if signatures:
        references = ", ".join(f"{item.get('original_filename', '')} ({item.get('id', '')})" for item in signatures)
        story.extend(
            _section(labels["signature_reference"], [(labels["signature_reference"], references)], styles)
        )
    story.extend(_evidence_sections(snapshot=snapshot, labels=labels, styles=styles))

    document.build(story)
    return buffer.getvalue()


def _section(title: str, rows: list[tuple[str, Any]], styles) -> list[Any]:
    table_data = [
        [Paragraph(_p(str(label)), styles["BodyText"]), Paragraph(_p(_value(value)), styles["BodyText"])]
        for label, value in rows
    ]
    table = Table(table_data, colWidths=[150, 330])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return [Paragraph(_p(title), styles["Heading2"]), table, Spacer(1, 10)]


def _borrower_snapshot_rows(borrower: dict[str, Any], labels: dict[str, str]) -> list[tuple[str, Any]]:
    company = borrower.get("company") or {}
    return [
        (labels["borrower"], borrower.get("name", "")),
        (labels["borrower_phone"], borrower.get("phone", "")),
        (labels["company"], company.get("name") or labels["not_available"]),
        (labels["expected_return"], _format_datetime(borrower.get("expected_return_at"))),
        (
            labels["actual_return"],
            _format_datetime(borrower.get("actual_return_at"))
            if borrower.get("actual_return_at")
            else labels["not_available"],
        ),
    ]


def _damage_snapshot_rows(damages: list[dict[str, Any]], labels: dict[str, str]) -> list[tuple[str, Any]]:
    if not damages:
        return [(labels["damage_notes"], labels["no_damage"])]
    return [
        (
            _format_datetime(damage.get("discovered_at")),
            f"{labels.get(damage.get('severity', 'unknown'), labels['unknown'])}: {damage.get('description', '')}",
        )
        for damage in damages
    ]


def _evidence_sections(*, snapshot: dict[str, Any], labels: dict[str, str], styles) -> list[Any]:
    photo_refs: list[tuple[dict[str, Any], str]] = []
    signature_refs: list[tuple[dict[str, Any], str]] = []
    seen: set[str] = set()

    def add(items, caption, *, signatures=False):
        for item in items or []:
            media_id = str(item.get("id") or "")
            if not media_id or media_id in seen:
                continue
            seen.add(media_id)
            if item.get("media_type") == MediaType.SIGNATURE or signatures:
                signature_refs.append((item, caption))
            elif item.get("media_type") == MediaType.PHOTO:
                photo_refs.append((item, caption))

    add(snapshot.get("media"), labels["photo_evidence"])
    add(snapshot.get("signatures"), labels["signature_evidence"], signatures=True)
    for damage in snapshot.get("damages") or []:
        add(damage.get("media"), damage.get("description") or labels["damage_notes"])

    flowables: list[Any] = []
    if photo_refs:
        cells = []
        for item, caption in photo_refs:
            image_bytes = _validated_evidence_image(item, signature=False)
            image = Image(BytesIO(image_bytes), width=220, height=150, kind="proportional")
            detail = Paragraph(
                _p(
                    f"{caption}\n{item.get('original_filename', '')}\n"
                    f"{labels['content_hash']}: {item.get('content_sha256', '')}"
                ),
                styles["BodyText"],
            )
            cells.append([image, detail])
        table = Table(cells, colWidths=[230, 250], repeatRows=0)
        table.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("PADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        flowables.extend([Paragraph(_p(labels["photo_evidence"]), styles["Heading2"]), table, Spacer(1, 10)])
    if signature_refs:
        flowables.append(Paragraph(_p(labels["signature_evidence"]), styles["Heading2"]))
        for item, caption in signature_refs:
            image_bytes = _validated_evidence_image(item, signature=True)
            flowables.extend(
                [
                    Image(BytesIO(image_bytes), width=300, height=100, kind="proportional"),
                    Paragraph(
                        _p(
                            f"{caption}: {item.get('original_filename', '')}\n"
                            f"{labels['content_hash']}: {item.get('content_sha256', '')}"
                        ),
                        styles["BodyText"],
                    ),
                    Spacer(1, 8),
                ]
            )
    return flowables


def _validated_evidence_image(reference: dict[str, Any], *, signature: bool) -> bytes:
    """Read an authorized immutable original, verify its hash, and compress it."""

    from PIL import Image as PillowImage

    media = MediaFile.objects.filter(
        pk=reference.get("id"),
        media_type=MediaType.SIGNATURE if signature else MediaType.PHOTO,
        attached_at__isnull=False,
    ).first()
    if media is None or not default_storage.exists(media.storage_key):
        raise serializers.ValidationError({"document": _("Protocol evidence media is missing.")})
    with default_storage.open(media.storage_key, "rb") as stored:
        content = stored.read(int(settings.MAX_UPLOAD_SIZE_MB) * 1024 * 1024 + 1)
    if len(content) > int(settings.MAX_UPLOAD_SIZE_MB) * 1024 * 1024:
        raise serializers.ValidationError({"document": _("Protocol evidence image exceeds the size limit.")})
    digest = hashlib.sha256(content).hexdigest()
    if digest != media.content_sha256 or digest != reference.get("content_sha256"):
        raise serializers.ValidationError({"document": _("Protocol evidence failed its integrity check.")})
    try:
        source = PillowImage.open(BytesIO(content))
        source.verify()
        source = PillowImage.open(BytesIO(content))
        if source.width * source.height > int(settings.MAX_PDF_EVIDENCE_PIXELS):
            raise serializers.ValidationError(
                {"document": _("Protocol evidence image dimensions exceed the configured pixel limit.")}
            )
        source.thumbnail((1200, 900))
        if source.mode not in {"RGB", "L"}:
            background = PillowImage.new("RGB", source.size, "white")
            if "A" in source.getbands():
                background.paste(source, mask=source.getchannel("A"))
            else:
                background.paste(source.convert("RGB"))
            source = background
        elif source.mode == "L":
            source = source.convert("RGB")
        output = BytesIO()
        source.save(output, format="JPEG", quality=72, optimize=True)
        return output.getvalue()
    except serializers.ValidationError:
        raise
    except Exception as exc:
        raise serializers.ValidationError({"document": _("Protocol evidence is not a valid image.")}) from exc


def _legacy_snapshot(*, document_type: str, record) -> dict[str, Any]:
    """Persist a one-time baseline snapshot for records predating snapshots."""

    from workflows.services import _check_in_snapshot, _loan_snapshot, _manufacturer_snapshot

    if document_type == CHECK_IN_DOCUMENT:
        return _check_in_snapshot(
            protocol=record,
            vehicle=record.vehicle,
            damages=list(record.damage_reports.all()),
        )
    if document_type in {LOAN_CHECKOUT_DOCUMENT, LOAN_RETURN_DOCUMENT}:
        phase = (
            DamageWorkflowPhase.LOAN_CHECKOUT
            if document_type == LOAN_CHECKOUT_DOCUMENT
            else DamageWorkflowPhase.LOAN_RETURN
        )
        related_type = "loan_checkout" if document_type == LOAN_CHECKOUT_DOCUMENT else "loan_return"
        media = list(
            MediaFile.objects.filter(related_type=related_type, related_id=record.id).order_by("created_at")
        )
        return _loan_snapshot(
            loan=record,
            vehicle=record.vehicle,
            damages=list(record.damage_reports.filter(workflow_phase=phase)),
            phase=phase,
            media=media,
        )
    if document_type == MANUFACTURER_CHECKOUT_DOCUMENT:
        media = list(
            MediaFile.objects.filter(
                related_type="manufacturer_checkout_protocol",
                related_id=record.id,
            ).order_by("created_at")
        )
        return _manufacturer_snapshot(
            protocol=record,
            vehicle=record.vehicle,
            damages=list(record.damage_reports.all()),
            media=media,
        )
    raise serializers.ValidationError({"document": _("Unsupported workflow document type.")})


def _protocol_number(document_type: str, record) -> str:
    prefixes = {
        CHECK_IN_DOCUMENT: "CI",
        LOAN_CHECKOUT_DOCUMENT: "LC",
        LOAN_RETURN_DOCUMENT: "LR",
        MANUFACTURER_CHECKOUT_DOCUMENT: "MC",
    }
    return f"{prefixes[document_type]}-{record.id}"


def _language(language: str | None) -> str:
    code = (language or getattr(settings, "LANGUAGE_CODE", "de") or "de").split("-", 1)[0].lower()
    if code not in SUPPORTED_PDF_LANGUAGES:
        raise serializers.ValidationError({"language": _("Unsupported PDF language.")})
    return code


def _format_datetime(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        from django.utils.dateparse import parse_datetime

        parsed = parse_datetime(value)
        if parsed is None:
            return value
        value = parsed
    return timezone.localtime(value).strftime("%d.%m.%Y %H:%M")


def _display_user(user) -> str:
    if user is None:
        return ""
    return getattr(user, "display_name", "") or user.get_username()


def _status_label(status: str, labels: dict[str, str]) -> str:
    if status == VehicleStatus.MANUFACTURER_CHECKOUT:
        return labels["manufacturer_checkout_status"]
    return labels.get(status, status)


def _value(value, labels: dict[str, str] | None = None) -> str:
    if value is None or value == "":
        return labels["not_available"] if labels else ""
    return str(value)


def _p(value: str) -> str:
    return escape(value).replace("\n", "<br/>")

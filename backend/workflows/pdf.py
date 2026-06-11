"""Localized immutable PDF protocol generation for workflows."""

from __future__ import annotations

from io import BytesIO
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
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework import serializers

from audit.models import AuditLog
from damages.models import DamageReport, DamageWorkflowPhase
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import create_media_file_from_bytes
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


def generate_check_in_pdf(*, protocol: CheckInProtocol, actor, language: str | None = None) -> MediaFile:
    return _generate_document(
        document_type=CHECK_IN_DOCUMENT,
        record=protocol,
        actor=actor,
        language=language,
        title_key="check_in_title",
        workflow_key="check_in",
        performed_at=protocol.performed_at,
        performed_by=protocol.performed_by,
        vehicle=protocol.vehicle,
        readings={"odometer": protocol.odometer_km, "operating_hours": protocol.operating_hours},
        party_label="supplier",
        party=protocol.supplier_company,
        notes=protocol.condition_notes,
        damages=protocol.damage_reports.all(),
        link_fields=("pdf_media", "pdf_language"),
    )


def generate_loan_checkout_pdf(*, loan: Loan, actor, language: str | None = None) -> MediaFile:
    return _generate_document(
        document_type=LOAN_CHECKOUT_DOCUMENT,
        record=loan,
        actor=actor,
        language=language,
        title_key="loan_checkout_title",
        workflow_key="loan_checkout",
        performed_at=loan.created_at,
        performed_by=loan.created_by,
        vehicle=loan.vehicle,
        readings={"odometer": loan.checkout_odometer_km, "operating_hours": loan.checkout_operating_hours},
        borrower=loan,
        notes=loan.checkout_notes,
        damages=loan.damage_reports.filter(workflow_phase=DamageWorkflowPhase.LOAN_CHECKOUT),
        link_fields=("checkout_pdf_media", "checkout_pdf_language"),
    )


def generate_loan_return_pdf(*, loan: Loan, actor, language: str | None = None) -> MediaFile:
    if loan.actual_return_at is None:
        raise serializers.ValidationError({"loan": _("Loan return PDF requires a returned loan.")})
    return _generate_document(
        document_type=LOAN_RETURN_DOCUMENT,
        record=loan,
        actor=actor,
        language=language,
        title_key="loan_return_title",
        workflow_key="loan_return",
        performed_at=loan.actual_return_at,
        performed_by=loan.returned_by,
        vehicle=loan.vehicle,
        readings={"odometer": loan.return_odometer_km, "operating_hours": loan.return_operating_hours},
        borrower=loan,
        notes=loan.return_notes,
        damages=loan.damage_reports.filter(workflow_phase=DamageWorkflowPhase.LOAN_RETURN),
        link_fields=("return_pdf_media", "return_pdf_language"),
    )


def generate_manufacturer_checkout_pdf(
    *, protocol: ManufacturerCheckOutProtocol, actor, language: str | None = None
) -> MediaFile:
    return _generate_document(
        document_type=MANUFACTURER_CHECKOUT_DOCUMENT,
        record=protocol,
        actor=actor,
        language=language,
        title_key="manufacturer_checkout_title",
        workflow_key="manufacturer_checkout",
        performed_at=protocol.performed_at,
        performed_by=protocol.performed_by,
        vehicle=protocol.vehicle,
        readings={"odometer": protocol.odometer_km, "operating_hours": protocol.operating_hours},
        party_label="recipient",
        party=protocol.recipient_company,
        notes=protocol.condition_notes,
        damages=protocol.damage_reports.all(),
        link_fields=("pdf_media", "pdf_language"),
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
    performed_at,
    performed_by,
    vehicle,
    readings: dict[str, Any],
    notes: str,
    damages,
    link_fields: tuple[str, str],
    party_label: str | None = None,
    party=None,
    borrower: Loan | None = None,
) -> MediaFile:
    language_code = _language(language)
    existing = _existing_document(document_type=document_type, record=record, language=language_code)
    if existing is not None:
        _link_record_if_empty(record=record, media=existing, language=language_code, link_fields=link_fields)
        return existing

    labels = _T[language_code]
    protocol_number = _protocol_number(document_type, record)
    signature = _signature_reference(document_type=document_type, record=record, labels=labels)
    pdf_bytes = _render_pdf(
        labels=labels,
        title=labels[title_key],
        protocol_number=protocol_number,
        language=language_code,
        workflow_type=labels[workflow_key],
        performed_at=performed_at,
        performed_by=performed_by,
        vehicle=vehicle,
        readings=readings,
        party_label=party_label,
        party=party,
        borrower=borrower,
        notes=notes,
        damages=list(damages),
        signature=signature,
    )
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
    )
    _link_record_if_empty(record=record, media=media, language=language_code, link_fields=link_fields)
    AuditLog.objects.create(
        actor=actor,
        action="document.pdf.generated",
        entity_type=document_type,
        entity_id=record.id,
        after={
            "media_id": str(media.id),
            "language": language_code,
            "protocol_number": protocol_number,
        },
    )
    return media


def _existing_document(*, document_type: str, record, language: str) -> MediaFile | None:
    media = (
        MediaFile.objects.filter(
            media_type=MediaType.PDF,
            related_type=document_type,
            related_id=record.id,
            language=language,
        )
        .order_by("created_at")
        .first()
    )
    if media is not None and default_storage.exists(media.storage_key):
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
    performed_at,
    performed_by,
    vehicle,
    readings: dict[str, Any],
    party_label: str | None,
    party,
    borrower: Loan | None,
    notes: str,
    damages: list[DamageReport],
    signature: str,
) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, title=title)
    styles = getSampleStyleSheet()
    story = [Paragraph(_p(title), styles["Title"]), Spacer(1, 12)]

    rows = [
        (labels["protocol_number"], protocol_number),
        (labels["language"], labels["language_name"]),
        (labels["workflow_type"], workflow_type),
        (labels["date_time"], _format_datetime(performed_at)),
        (labels["user"], _display_user(performed_by)),
    ]
    story.extend(_section(labels["workflow_type"], rows, styles))

    vehicle_rows = [
        (labels["internal_number"], vehicle.internal_number),
        (labels["manufacturer_model"], f"{vehicle.manufacturer} {vehicle.model}".strip()),
        (labels["serial_number"], vehicle.serial_number),
        (labels["license_plate"], vehicle.license_plate),
        (labels["status"], _status_label(vehicle.status, labels)),
    ]
    story.extend(_section(labels["vehicle"], vehicle_rows, styles))

    reading_rows = [
        (labels["odometer"], _value(readings.get("odometer"), labels)),
        (labels["operating_hours"], _value(readings.get("operating_hours"), labels)),
    ]
    story.extend(_section(labels["readings"], reading_rows, styles))

    if party_label and party is not None:
        story.extend(_section(labels[party_label], [(labels[party_label], str(party))], styles))
    if borrower is not None:
        story.extend(_section(labels["borrower"], _borrower_rows(borrower, labels), styles))

    story.extend(_section(labels["notes"], [(labels["notes"], notes or labels["not_available"])], styles))
    damage_rows = _damage_rows(damages, labels)
    story.extend(_section(labels["damage_notes"], damage_rows, styles))
    story.extend(_section(labels["signature_reference"], [(labels["signature_reference"], signature)], styles))

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


def _borrower_rows(loan: Loan, labels: dict[str, str]) -> list[tuple[str, Any]]:
    borrower = str(loan.driver) if loan.driver_id else loan.borrower_name
    return [
        (labels["borrower"], borrower),
        (labels["borrower_phone"], loan.borrower_phone),
        (labels["company"], str(loan.company) if loan.company_id else labels["not_available"]),
        (labels["expected_return"], _format_datetime(loan.expected_return_at)),
        (
            labels["actual_return"],
            _format_datetime(loan.actual_return_at) if loan.actual_return_at else labels["not_available"],
        ),
    ]


def _damage_rows(damages: list[DamageReport], labels: dict[str, str]) -> list[tuple[str, Any]]:
    if not damages:
        return [(labels["damage_notes"], labels["no_damage"])]
    return [
        (
            _format_datetime(damage.discovered_at),
            f"{labels.get(damage.severity, labels['unknown'])}: {damage.description}",
        )
        for damage in damages
    ]


def _signature_reference(*, document_type: str, record, labels: dict[str, str]) -> str:
    media = (
        MediaFile.objects.filter(
            media_type=MediaType.SIGNATURE,
            related_id=record.id,
        )
        .filter(related_type__in=_signature_related_types(document_type))
        .order_by("created_at")
        .first()
    )
    if media is None:
        return labels["not_available"]
    return f"{media.original_filename} ({media.id})"


def _signature_related_types(document_type: str) -> list[str]:
    if document_type == CHECK_IN_DOCUMENT:
        return ["check_in_protocol"]
    if document_type == LOAN_CHECKOUT_DOCUMENT:
        return ["loan_checkout"]
    if document_type == LOAN_RETURN_DOCUMENT:
        return ["loan_return"]
    if document_type == MANUFACTURER_CHECKOUT_DOCUMENT:
        return ["manufacturer_checkout_protocol"]
    return []


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

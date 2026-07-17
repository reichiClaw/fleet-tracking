"""Transactional services for operational vehicle workflows."""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from audit.services import audit_event
from damages.models import DamageReport, DamageWorkflowPhase
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import attach_media_files
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows import pdf
from workflows.models import (
    CheckInProtocol,
    ConditionOutcome,
    Loan,
    LoanStatus,
    MaintenanceRecord,
    MaintenanceStatus,
    ManufacturerCheckOutProtocol,
    Reservation,
    ReservationStatus,
)

RESERVATION_EARLY_HANDOVER_HOURS = int(settings.RESERVATION_EARLY_HANDOVER_HOURS)
logger = logging.getLogger("fleet")


def _auto_generate_pdf(*, generator, record, error_field: str, actor, request_meta: dict[str, str]) -> None:
    """Generate a PDF and persist a visible, audited failure when it fails."""
    try:
        generator()
    except Exception as exc:  # noqa: BLE001 - workflow completion remains authoritative
        logger.exception(
            "Automatic PDF generation failed for %s %s",
            record._meta.model_name,
            record.pk,
        )
        message = (
            str(exc.detail)[:1000]
            if isinstance(exc, serializers.ValidationError)
            else f"{exc.__class__.__name__}: {str(_('PDF generation failed.'))}"
        )
        setattr(record, error_field, message)
        record.save(update_fields=[error_field, "updated_at"])
        audit_event(
            actor=actor,
            action="pdf.generation_failed",
            entity_type=record._meta.model_name,
            entity_id=record.id,
            after={"error": message, "field": error_field},
            request_meta=request_meta,
        )
    else:
        record.refresh_from_db()


def complete_check_in(
    *,
    data: dict[str, Any],
    actor,
    request_meta: dict[str, str] | None = None,
    language: str | None = None,
    idempotency_key: str | None = None,
    request_fingerprint: str | None = None,
) -> CheckInProtocol:
    """Create a check-in protocol and update the vehicle in one transaction."""
    request_meta = request_meta or {}
    request_fingerprint = request_fingerprint or _request_fingerprint(data)
    with transaction.atomic():
        if idempotency_key:
            existing = CheckInProtocol.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
            if existing:
                return _check_in_idempotent_replay(
                    existing=existing,
                    actor=actor,
                    vehicle_id=data["vehicle"].id,
                    request_fingerprint=request_fingerprint,
                )
        vehicle = _locked_vehicle(data["vehicle"])
        if idempotency_key:
            existing = CheckInProtocol.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                return _check_in_idempotent_replay(
                    existing=existing,
                    actor=actor,
                    vehicle_id=vehicle.id,
                    request_fingerprint=request_fingerprint,
                )
        before = _vehicle_snapshot(vehicle)
        if vehicle.status != VehicleStatus.ANNOUNCED:
            raise serializers.ValidationError({"vehicle": [_("Only announced vehicles can be checked in.")]})
        _validate_company(
            data.get("supplier_company"),
            allowed_types={Company.CompanyType.SUPPLIER, Company.CompanyType.MANUFACTURER},
            field="supplier_company",
            required=True,
        )
        _validate_category_readings(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )

        performed_at = data.get("performed_at") or timezone.now()
        if performed_at > timezone.now():
            raise serializers.ValidationError({"performed_at": [_("Workflow timestamp cannot be in the future.")]})
        damage_payloads = data.get("damage_reports", [])
        if data.get("condition_outcome") == ConditionOutcome.MAINTENANCE and not (
            data.get("condition_notes") or ""
        ).strip():
            raise serializers.ValidationError(
                {"condition_notes": [_("A maintenance outcome requires a reason in the workflow notes.")]}
            )
        target_status = _condition_target_status(
            vehicle=vehicle,
            condition_outcome=data.get("condition_outcome"),
            damage_payloads=damage_payloads,
        )
        try:
            # The savepoint keeps the outer transaction usable if another
            # request concurrently commits the same globally unique key.
            with transaction.atomic():
                protocol = CheckInProtocol.objects.create(
                    vehicle=vehicle,
                    performed_by=actor,
                    performed_at=performed_at,
                    supplier_company=data.get("supplier_company"),
                    odometer_km=data.get("odometer_km"),
                    operating_hours=data.get("operating_hours"),
                    condition_notes=data.get("condition_notes", ""),
                    idempotency_key=idempotency_key,
                    request_fingerprint=request_fingerprint,
                )
        except IntegrityError:
            if not idempotency_key:
                raise
            existing = CheckInProtocol.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
            if existing is None:
                raise
            return _check_in_idempotent_replay(
                existing=existing,
                actor=actor,
                vehicle_id=vehicle.id,
                request_fingerprint=request_fingerprint,
            )
        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=damage_payloads,
            workflow_phase=DamageWorkflowPhase.CHECK_IN,
            check_in_protocol=protocol,
            request_meta=request_meta,
        )
        attached = _attach_media(
            vehicle=vehicle,
            related_type="check_in_protocol",
            related_id=protocol.id,
            existing_media=data.get("media_file_ids", []),
            actor=actor,
            request_meta=request_meta,
        )
        _transition_vehicle(
            vehicle,
            target_status=target_status,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
        )
        _open_maintenance_from_outcome(
            vehicle=vehicle,
            outcome=data.get("condition_outcome"),
            reason=data.get("condition_notes", ""),
            performed_at=performed_at,
            actor=actor,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            media=attached,
            request_meta=request_meta,
        )
        protocol.snapshot = _check_in_snapshot(
            protocol=protocol,
            vehicle=vehicle,
            damages=damages,
            media=attached,
            condition_outcome=data.get("condition_outcome"),
        )
        protocol.save(update_fields=["snapshot", "updated_at"])
        _create_audit_log(
            actor=actor,
            action="workflow.check_in.completed",
            entity_type="check_in_protocol",
            entity_id=protocol.id,
            before=before,
            after={
                "vehicle": _vehicle_snapshot(vehicle),
                "protocol_id": str(protocol.id),
                "damage_report_ids": [str(damage.id) for damage in damages],
            },
            request_meta=request_meta,
        )
        _auto_generate_pdf(
            generator=lambda: pdf.generate_check_in_pdf(
                protocol=protocol, actor=actor, language=language, request_meta=request_meta
            ),
            record=protocol,
            error_field="pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
        return protocol


@transaction.atomic
def create_and_complete_check_in(
    *,
    data: dict[str, Any],
    actor,
    request_meta: dict[str, str] | None = None,
    language: str | None = None,
    idempotency_key: str | None = None,
) -> CheckInProtocol:
    """Create an announced master record and complete check-in as one unit."""

    request_meta = request_meta or {}
    fingerprint = _request_fingerprint(data)
    if idempotency_key:
        existing = CheckInProtocol.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
        if existing:
            if existing.performed_by_id != actor.id or existing.request_fingerprint != fingerprint:
                raise serializers.ValidationError(
                    {"idempotency_key": [_("This idempotency key was already used for another request.")]}
                )
            existing._idempotent_replay = True
            return existing

    vehicle_fields = {
        field: data.get(field)
        for field in (
            "internal_number",
            "category",
            "manufacturer",
            "model",
            "serial_number",
            "license_plate",
            "current_location",
            "notes",
            "manufacturer_return_due",
            "external_key",
        )
        if field in data
    }
    vehicle_fields["status"] = VehicleStatus.ANNOUNCED
    vehicle_fields["current_odometer_km"] = data.get("odometer_km")
    vehicle_fields["current_operating_hours"] = data.get("operating_hours")
    vehicle = Vehicle.objects.create(**vehicle_fields)
    audit_event(
        actor=actor,
        action="vehicle.created",
        entity_type="vehicle",
        entity_id=vehicle.id,
        after={"internal_number": vehicle.internal_number, "status": VehicleStatus.ANNOUNCED},
        request_meta=request_meta,
    )
    workflow_data = {
        field: data.get(field)
        for field in (
            "performed_at",
            "supplier_company",
            "odometer_km",
            "operating_hours",
            "condition_notes",
            "condition_outcome",
            "damage_reports",
            "media_file_ids",
        )
        if field in data
    }
    workflow_data["vehicle"] = vehicle
    protocol = complete_check_in(
        data=workflow_data,
        actor=actor,
        request_meta=request_meta,
        language=language,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
    )
    audit_event(
        actor=actor,
        action="workflow.create_and_check_in.completed",
        entity_type="check_in_protocol",
        entity_id=protocol.id,
        after={"vehicle_id": str(vehicle.id), "status": vehicle.status},
        request_meta=request_meta,
    )
    return protocol


def complete_loan_checkout(
    *, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None, language: str | None = None
) -> Loan:
    """Create an active loan and mark the vehicle loaned atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        vehicle = _locked_vehicle(data["vehicle"])
        reservation = None
        if data.get("reservation") is not None:
            reservation = (
                Reservation.objects.select_for_update()
                .select_related("driver", "company")
                .get(pk=data["reservation"].pk)
            )
        before = _vehicle_snapshot(vehicle)
        if vehicle.status != VehicleStatus.AVAILABLE:
            raise serializers.ValidationError({"vehicle": [_("Only available vehicles can be loaned.")]})
        if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
            raise serializers.ValidationError({"vehicle": [_("This vehicle already has an active loan.")]})
        if reservation is not None:
            _validate_reservation_for_checkout(
                reservation=reservation,
                vehicle=vehicle,
                data=data,
            )
            _prefill_or_validate_reservation_party(reservation=reservation, data=data)
        reservation_warnings = _validate_reservation_checkout_conflicts(
            vehicle=vehicle,
            expected_return_at=data["expected_return_at"],
            selected_reservation=reservation,
        )
        _validate_company(
            data.get("company"),
            allowed_types={Company.CompanyType.SUBCONTRACTOR, Company.CompanyType.INTERNAL},
            field="company",
        )
        _validate_driver(data.get("driver"), company=data.get("company"))
        if not (data.get("borrower_name") or "").strip():
            raise serializers.ValidationError({"borrower_name": [_("Borrower name is required.")]})
        if not (data.get("borrower_phone") or "").strip():
            raise serializers.ValidationError({"borrower_phone": [_("Borrower phone is required.")]})
        if data["expected_return_at"] <= timezone.now():
            raise serializers.ValidationError({"expected_return_at": [_("Expected return must be after checkout.")]})
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("checkout_odometer_km"),
            operating_hours=data.get("checkout_operating_hours"),
            odometer_field="checkout_odometer_km",
            hours_field="checkout_operating_hours",
        )
        _validate_category_readings(
            vehicle,
            odometer=data.get("checkout_odometer_km"),
            operating_hours=data.get("checkout_operating_hours"),
            odometer_field="checkout_odometer_km",
            hours_field="checkout_operating_hours",
        )

        try:
            with transaction.atomic():
                loan = Loan.objects.create(
                    vehicle=vehicle,
                    company=data.get("company"),
                    driver=data.get("driver"),
                    borrower_name=data.get("borrower_name", ""),
                    borrower_phone=data.get("borrower_phone", ""),
                    expected_return_at=data["expected_return_at"],
                    checkout_odometer_km=data.get("checkout_odometer_km"),
                    checkout_operating_hours=data.get("checkout_operating_hours"),
                    checkout_notes=data.get("checkout_notes", ""),
                    created_by=actor,
                )
        except IntegrityError as exc:
            raise serializers.ValidationError({"vehicle": [_("This vehicle already has an active loan.")]}) from exc
        if loan.expected_return_at <= loan.created_at:
            raise serializers.ValidationError({"expected_return_at": [_("Expected return must be after checkout.")]})
        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=data.get("damage_reports", []),
            workflow_phase=DamageWorkflowPhase.LOAN_CHECKOUT,
            loan=loan,
            request_meta=request_meta,
        )
        attached = _attach_media(
            vehicle=vehicle,
            loan=loan,
            related_type="loan_checkout",
            related_id=loan.id,
            existing_media=data.get("media_file_ids", []),
            actor=actor,
            request_meta=request_meta,
        )
        if not any(media.media_type == MediaType.SIGNATURE for media in attached):
            raise serializers.ValidationError(
                {"media_file_ids": [_("Loan checkout requires an uploaded signature.")]}
            )
        _transition_vehicle(
            vehicle,
            target_status=VehicleStatus.LOANED,
            odometer=data.get("checkout_odometer_km"),
            operating_hours=data.get("checkout_operating_hours"),
        )
        loan.checkout_snapshot = _loan_snapshot(
            loan=loan,
            vehicle=vehicle,
            damages=damages,
            phase=DamageWorkflowPhase.LOAN_CHECKOUT,
            media=attached,
            reservation=reservation,
        )
        loan.save(update_fields=["checkout_snapshot", "updated_at"])
        if reservation is not None:
            reservation.status = ReservationStatus.FULFILLED
            reservation.fulfilled_at = timezone.now()
            reservation.fulfilled_by = actor
            reservation.loan = loan
            reservation.save(
                update_fields=[
                    "status",
                    "fulfilled_at",
                    "fulfilled_by",
                    "loan",
                    "updated_at",
                ]
            )
            audit_event(
                actor=actor,
                action="reservation.fulfilled",
                entity_type="reservation",
                entity_id=reservation.id,
                before={"status": ReservationStatus.ACTIVE},
                after={
                    "status": reservation.status,
                    "loan_id": str(loan.id),
                    "fulfilled_at": reservation.fulfilled_at.isoformat(),
                },
                request_meta=request_meta,
            )
        _create_audit_log(
            actor=actor,
            action="workflow.loan_checkout.completed",
            entity_type="loan",
            entity_id=loan.id,
            before=before,
            after={
                "vehicle": _vehicle_snapshot(vehicle),
                "loan_id": str(loan.id),
                "damage_report_ids": [str(damage.id) for damage in damages],
            },
            request_meta=request_meta,
        )
        _auto_generate_pdf(
            generator=lambda: pdf.generate_loan_checkout_pdf(
                loan=loan, actor=actor, language=language, request_meta=request_meta
            ),
            record=loan,
            error_field="checkout_pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
        loan._warnings = reservation_warnings
        return loan


def complete_loan_return(
    *, loan: Loan, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None, language: str | None = None
) -> Loan:
    """Close a referenced active loan and update the vehicle atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        locked_loan = Loan.objects.select_for_update().select_related("vehicle").get(pk=loan.pk)
        if locked_loan.status != LoanStatus.ACTIVE:
            raise serializers.ValidationError({"loan": [_("Loan return requires an active loan.")]})
        vehicle = _locked_vehicle(locked_loan.vehicle)
        before = _vehicle_snapshot(vehicle)
        actual_return_at = data.get("actual_return_at") or timezone.now()
        if actual_return_at < locked_loan.created_at:
            raise serializers.ValidationError(
                {"actual_return_at": [_("Return timestamp must not be earlier than checkout.")]}
            )
        if actual_return_at > timezone.now():
            raise serializers.ValidationError({"actual_return_at": [_("Return timestamp cannot be in the future.")]})
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
            odometer_field="return_odometer_km",
            hours_field="return_operating_hours",
        )
        _validate_category_readings(
            vehicle,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
            odometer_field="return_odometer_km",
            hours_field="return_operating_hours",
        )
        _validate_return_deltas(locked_loan, data)

        damage_payloads = data.get("damage_reports", [])
        if data.get("condition_outcome") == ConditionOutcome.MAINTENANCE and not (
            data.get("return_notes") or ""
        ).strip():
            raise serializers.ValidationError(
                {"return_notes": [_("A maintenance outcome requires a reason in the workflow notes.")]}
            )
        target_status = _condition_target_status(
            vehicle=vehicle,
            condition_outcome=data.get("condition_outcome"),
            damage_payloads=damage_payloads,
        )
        locked_loan.return_odometer_km = data.get("return_odometer_km")
        locked_loan.return_operating_hours = data.get("return_operating_hours")
        locked_loan.return_notes = data.get("return_notes", "")
        locked_loan.return_condition_outcome = data["condition_outcome"]
        locked_loan.actual_return_at = actual_return_at
        locked_loan.status = LoanStatus.RETURNED
        locked_loan.returned_by = actor
        locked_loan.save()

        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=damage_payloads,
            workflow_phase=DamageWorkflowPhase.LOAN_RETURN,
            loan=locked_loan,
            request_meta=request_meta,
        )
        attached = _attach_media(
            vehicle=vehicle,
            loan=locked_loan,
            related_type="loan_return",
            related_id=locked_loan.id,
            existing_media=data.get("media_file_ids", []),
            actor=actor,
            request_meta=request_meta,
        )
        from django.conf import settings

        if getattr(settings, "RETURN_SIGNATURE_REQUIRED", False) and not any(
            media.media_type == MediaType.SIGNATURE for media in attached
        ):
            raise serializers.ValidationError(
                {"media_file_ids": [_("A return signature is required by policy.")]}
            )
        _transition_vehicle(
            vehicle,
            target_status=target_status,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
        )
        _open_maintenance_from_outcome(
            vehicle=vehicle,
            outcome=data.get("condition_outcome"),
            reason=data.get("return_notes", ""),
            performed_at=actual_return_at,
            actor=actor,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
            media=attached,
            request_meta=request_meta,
        )
        locked_loan.return_snapshot = _loan_snapshot(
            loan=locked_loan,
            vehicle=vehicle,
            damages=damages,
            phase=DamageWorkflowPhase.LOAN_RETURN,
            media=attached,
            condition_outcome=data.get("condition_outcome"),
        )
        locked_loan.save(update_fields=["return_snapshot", "updated_at"])
        _create_audit_log(
            actor=actor,
            action="workflow.loan_return.completed",
            entity_type="loan",
            entity_id=locked_loan.id,
            before=before,
            after={
                "vehicle": _vehicle_snapshot(vehicle),
                "loan_id": str(locked_loan.id),
                "damage_report_ids": [str(damage.id) for damage in damages],
            },
            request_meta=request_meta,
        )
        _auto_generate_pdf(
            generator=lambda: pdf.generate_loan_return_pdf(
                loan=locked_loan, actor=actor, language=language, request_meta=request_meta
            ),
            record=locked_loan,
            error_field="return_pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
        return locked_loan


def complete_manufacturer_checkout(
    *, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None, language: str | None = None
) -> ManufacturerCheckOutProtocol:
    """Create a manufacturer/supplier checkout protocol atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        vehicle = _locked_vehicle(data["vehicle"])
        before = _vehicle_snapshot(vehicle)
        if vehicle.status == VehicleStatus.LOANED:
            raise serializers.ValidationError(
                {"vehicle": [_("Loaned vehicles cannot be returned to manufacturers.")]}
            )
        if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
            raise serializers.ValidationError(
                {"vehicle": [_("Vehicles with an active loan cannot be checked out to manufacturers.")]}
            )
        if vehicle.status not in {
            VehicleStatus.AVAILABLE,
            VehicleStatus.DAMAGED,
        }:
            raise serializers.ValidationError(
                {"vehicle": [_("This vehicle cannot be returned to manufacturers from its current status.")]}
            )
        _validate_company(
            data.get("recipient_company"),
            allowed_types={Company.CompanyType.MANUFACTURER, Company.CompanyType.SUPPLIER},
            field="recipient_company",
            required=True,
        )
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )
        _validate_category_readings(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )

        performed_at = data.get("performed_at") or timezone.now()
        if performed_at > timezone.now():
            raise serializers.ValidationError({"performed_at": [_("Workflow timestamp cannot be in the future.")]})
        protocol = ManufacturerCheckOutProtocol.objects.create(
            vehicle=vehicle,
            performed_by=actor,
            performed_at=performed_at,
            recipient_company=data.get("recipient_company"),
            odometer_km=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            condition_notes=data.get("condition_notes", ""),
        )
        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=data.get("damage_reports", []),
            workflow_phase=DamageWorkflowPhase.MANUFACTURER_CHECKOUT,
            manufacturer_checkout_protocol=protocol,
            request_meta=request_meta,
        )
        attached = _attach_media(
            vehicle=vehicle,
            related_type="manufacturer_checkout_protocol",
            related_id=protocol.id,
            existing_media=data.get("media_file_ids", []),
            actor=actor,
            request_meta=request_meta,
        )
        _transition_vehicle(
            vehicle,
            target_status=VehicleStatus.MANUFACTURER_CHECKOUT,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
        )
        protocol.snapshot = _manufacturer_snapshot(
            protocol=protocol,
            vehicle=vehicle,
            damages=damages,
            media=attached,
        )
        protocol.save(update_fields=["snapshot", "updated_at"])
        _create_audit_log(
            actor=actor,
            action="workflow.manufacturer_checkout.completed",
            entity_type="manufacturer_checkout_protocol",
            entity_id=protocol.id,
            before=before,
            after={
                "vehicle": _vehicle_snapshot(vehicle),
                "protocol_id": str(protocol.id),
                "damage_report_ids": [str(damage.id) for damage in damages],
            },
            request_meta=request_meta,
        )
        _auto_generate_pdf(
            generator=lambda: pdf.generate_manufacturer_checkout_pdf(
                protocol=protocol, actor=actor, language=language, request_meta=request_meta
            ),
            record=protocol,
            error_field="pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
        return protocol


@transaction.atomic
def start_maintenance(*, vehicle: Vehicle, data: dict[str, Any], actor, request_meta=None) -> MaintenanceRecord:
    vehicle = _locked_vehicle(vehicle)
    if vehicle.status not in {VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED}:
        raise serializers.ValidationError(
            {"vehicle": [_("Only available or damaged vehicles can be sent to maintenance.")]}
        )
    if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
        raise serializers.ValidationError({"vehicle": [_("A vehicle with an active loan cannot enter maintenance.")]})
    if MaintenanceRecord.objects.select_for_update().filter(
        vehicle=vehicle, status=MaintenanceStatus.ACTIVE
    ).exists():
        raise serializers.ValidationError({"vehicle": [_("This vehicle already has active maintenance.")]})
    performed_at = data.get("performed_at") or timezone.now()
    if performed_at > timezone.now():
        raise serializers.ValidationError({"performed_at": [_("Workflow timestamp cannot be in the future.")]})
    _validate_optional_category_readings(
        vehicle,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
        odometer_field="odometer_km",
        hours_field="operating_hours",
    )
    _validate_readings_do_not_decrease(
        vehicle,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
        odometer_field="odometer_km",
        hours_field="operating_hours",
    )
    before = _vehicle_snapshot(vehicle)
    record = MaintenanceRecord.objects.create(
        vehicle=vehicle,
        reason=data["reason"].strip(),
        start_notes=data.get("notes", ""),
        started_at=performed_at,
        started_by=actor,
        start_odometer_km=data.get("odometer_km"),
        start_operating_hours=data.get("operating_hours"),
    )
    attached = _attach_media(
        vehicle=vehicle,
        related_type="maintenance_start",
        related_id=record.id,
        existing_media=data.get("media_file_ids", []),
        actor=actor,
        allowed_types={MediaType.PHOTO},
        request_meta=request_meta,
    )
    _transition_vehicle(
        vehicle,
        target_status=VehicleStatus.MAINTENANCE,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
    )
    record.start_snapshot = _maintenance_snapshot(record, vehicle, attached, completed=False)
    record.save(update_fields=["start_snapshot", "updated_at"])
    audit_event(
        actor=actor,
        action="workflow.maintenance.started",
        entity_type="maintenance_record",
        entity_id=record.id,
        before=before,
        after={"vehicle": _vehicle_snapshot(vehicle), "reason": record.reason},
        request_meta=request_meta,
    )
    return record


@transaction.atomic
def complete_maintenance(
    *,
    vehicle: Vehicle,
    data: dict[str, Any],
    actor,
    request_meta=None,
) -> MaintenanceRecord:
    vehicle = _locked_vehicle(vehicle)
    record = (
        MaintenanceRecord.objects.select_for_update()
        .filter(vehicle=vehicle, status=MaintenanceStatus.ACTIVE)
        .first()
    )
    if vehicle.status != VehicleStatus.MAINTENANCE or record is None:
        raise serializers.ValidationError({"vehicle": [_("This vehicle has no active maintenance to complete.")]})
    performed_at = data.get("performed_at") or timezone.now()
    if performed_at < record.started_at:
        raise serializers.ValidationError(
            {"performed_at": [_("Maintenance completion cannot be earlier than its start.")]}
        )
    if performed_at > timezone.now():
        raise serializers.ValidationError({"performed_at": [_("Workflow timestamp cannot be in the future.")]})
    _validate_optional_category_readings(
        vehicle,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
        odometer_field="odometer_km",
        hours_field="operating_hours",
    )
    _validate_readings_do_not_decrease(
        vehicle,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
        odometer_field="odometer_km",
        hours_field="operating_hours",
    )
    attached = _attach_media(
        vehicle=vehicle,
        related_type="maintenance_complete",
        related_id=record.id,
        existing_media=data.get("media_file_ids", []),
        actor=actor,
        allowed_types={MediaType.PHOTO},
        request_meta=request_meta,
    )
    target = (
        VehicleStatus.DAMAGED
        if DamageReport.objects.select_for_update().filter(
            vehicle=vehicle,
            resolved_at__isnull=True,
        ).exists()
        else VehicleStatus.AVAILABLE
    )
    before = _vehicle_snapshot(vehicle)
    _transition_vehicle(
        vehicle,
        target_status=target,
        odometer=data.get("odometer_km"),
        operating_hours=data.get("operating_hours"),
    )
    record.status = MaintenanceStatus.COMPLETED
    record.completed_at = performed_at
    record.completed_by = actor
    record.completion_notes = data.get("notes", "")
    record.completion_odometer_km = data.get("odometer_km")
    record.completion_operating_hours = data.get("operating_hours")
    record.save()
    record.completion_snapshot = _maintenance_snapshot(record, vehicle, attached, completed=True)
    record.save(update_fields=["completion_snapshot", "updated_at"])
    audit_event(
        actor=actor,
        action="workflow.maintenance.completed",
        entity_type="maintenance_record",
        entity_id=record.id,
        before=before,
        after={"vehicle": _vehicle_snapshot(vehicle), "status": record.status},
        request_meta=request_meta,
    )
    return record


def _open_maintenance_from_outcome(
    *,
    vehicle: Vehicle,
    outcome: str | None,
    reason: str,
    performed_at,
    actor,
    odometer,
    operating_hours,
    media,
    request_meta,
) -> MaintenanceRecord | None:
    if outcome != ConditionOutcome.MAINTENANCE:
        return None
    if MaintenanceRecord.objects.select_for_update().filter(
        vehicle=vehicle,
        status=MaintenanceStatus.ACTIVE,
    ).exists():
        raise serializers.ValidationError({"vehicle": [_("This vehicle already has active maintenance.")]})
    record = MaintenanceRecord.objects.create(
        vehicle=vehicle,
        reason=reason.strip(),
        start_notes=reason.strip(),
        started_at=performed_at,
        started_by=actor,
        start_odometer_km=odometer,
        start_operating_hours=operating_hours,
    )
    record.start_snapshot = _maintenance_snapshot(record, vehicle, media, completed=False)
    record.save(update_fields=["start_snapshot", "updated_at"])
    audit_event(
        actor=actor,
        action="workflow.maintenance.started",
        entity_type="maintenance_record",
        entity_id=record.id,
        after={"vehicle": _vehicle_snapshot(vehicle), "source": "condition_outcome"},
        request_meta=request_meta,
    )
    return record


def _locked_vehicle(vehicle_or_id) -> Vehicle:
    vehicle_id = getattr(vehicle_or_id, "pk", vehicle_or_id)
    return Vehicle.objects.select_for_update().get(pk=vehicle_id)


def _ensure_status(vehicle: Vehicle, *, disallowed: set[str], message) -> None:
    if vehicle.status in disallowed:
        raise serializers.ValidationError({"vehicle": [message]})


def _validate_readings_do_not_decrease(
    vehicle: Vehicle,
    *,
    odometer: int | None,
    operating_hours: Decimal | None,
    odometer_field: str,
    hours_field: str,
) -> None:
    errors: dict[str, list[Any]] = {}
    if vehicle.current_odometer_km is not None and odometer is not None and odometer < vehicle.current_odometer_km:
        errors[odometer_field] = [_("Odometer value must not decrease.")]
    if (
        vehicle.current_operating_hours is not None
        and operating_hours is not None
        and operating_hours < vehicle.current_operating_hours
    ):
        errors[hours_field] = [_("Operating hours must not decrease.")]
    if errors:
        raise serializers.ValidationError(errors)


def _validate_category_readings(
    vehicle: Vehicle,
    *,
    odometer,
    operating_hours,
    odometer_field: str,
    hours_field: str,
) -> None:
    mode = vehicle.category.meter_mode
    requires_odometer = mode in {VehicleCategory.MeterMode.ODOMETER, VehicleCategory.MeterMode.BOTH}
    requires_hours = mode in {VehicleCategory.MeterMode.HOURS, VehicleCategory.MeterMode.BOTH}
    errors = {}
    if requires_odometer and odometer is None:
        errors[odometer_field] = [_("An odometer reading is required for this vehicle category.")]
    if not requires_odometer and odometer is not None:
        errors[odometer_field] = [_("Odometer readings do not apply to this vehicle category.")]
    if requires_hours and operating_hours is None:
        errors[hours_field] = [_("An operating-hours reading is required for this vehicle category.")]
    if not requires_hours and operating_hours is not None:
        errors[hours_field] = [_("Operating-hours readings do not apply to this vehicle category.")]
    if errors:
        raise serializers.ValidationError(errors)


def _validate_optional_category_readings(
    vehicle: Vehicle,
    *,
    odometer,
    operating_hours,
    odometer_field: str,
    hours_field: str,
) -> None:
    mode = vehicle.category.meter_mode
    errors = {}
    if mode in {VehicleCategory.MeterMode.HOURS, VehicleCategory.MeterMode.NONE} and odometer is not None:
        errors[odometer_field] = [_("Odometer readings do not apply to this vehicle category.")]
    if mode in {VehicleCategory.MeterMode.ODOMETER, VehicleCategory.MeterMode.NONE} and operating_hours is not None:
        errors[hours_field] = [_("Operating-hours readings do not apply to this vehicle category.")]
    if errors:
        raise serializers.ValidationError(errors)


def _validate_return_deltas(loan: Loan, data: dict[str, Any]) -> None:
    errors = {}
    odometer = data.get("return_odometer_km")
    hours = data.get("return_operating_hours")
    if loan.checkout_odometer_km is not None and odometer is not None and odometer < loan.checkout_odometer_km:
        errors["return_odometer_km"] = [_("Return odometer must not be lower than checkout odometer.")]
    if (
        loan.checkout_operating_hours is not None
        and hours is not None
        and hours < loan.checkout_operating_hours
    ):
        errors["return_operating_hours"] = [
            _("Return operating hours must not be lower than checkout operating hours.")
        ]
    if errors:
        raise serializers.ValidationError(errors)


def _condition_target_status(
    *,
    vehicle: Vehicle,
    condition_outcome: str | None,
    damage_payloads: list[dict[str, Any]],
) -> str:
    if condition_outcome not in ConditionOutcome.values:
        raise serializers.ValidationError(
            {"condition_outcome": [_("An explicit condition outcome is required.")]}
        )
    has_unresolved_damage = bool(damage_payloads) or DamageReport.objects.filter(
        vehicle=vehicle,
        resolved_at__isnull=True,
    ).exists()
    if condition_outcome == ConditionOutcome.NEW_DAMAGE and not damage_payloads:
        raise serializers.ValidationError(
            {"damage_reports": [_("Damaged status requires at least one damage report.")]}
        )
    if condition_outcome == ConditionOutcome.FIT and damage_payloads:
        raise serializers.ValidationError(
            {"condition_outcome": [_("The fit outcome cannot include new damage reports.")]}
        )
    if condition_outcome == ConditionOutcome.MAINTENANCE:
        return VehicleStatus.MAINTENANCE
    return VehicleStatus.DAMAGED if has_unresolved_damage else VehicleStatus.AVAILABLE


def _check_in_idempotent_replay(
    *,
    existing: CheckInProtocol,
    actor,
    vehicle_id,
    request_fingerprint: str,
) -> CheckInProtocol:
    if (
        existing.performed_by_id != actor.id
        or existing.vehicle_id != vehicle_id
        or existing.request_fingerprint != request_fingerprint
    ):
        raise serializers.ValidationError(
            {"idempotency_key": [_("This idempotency key was already used for another request.")]}
        )
    existing._idempotent_replay = True
    return existing


def _transition_vehicle(
    vehicle: Vehicle,
    *,
    target_status: str,
    odometer: int | None,
    operating_hours: Decimal | None,
) -> None:
    statuses = _status_path(vehicle.status, target_status)
    if not statuses and odometer is None and operating_hours is None:
        return

    for index, status in enumerate(statuses or [vehicle.status]):
        final_step = index == len(statuses or [vehicle.status]) - 1
        update_fields = ["status", "updated_at"]
        vehicle.status = status
        if final_step:
            if odometer is not None:
                vehicle.current_odometer_km = odometer
                update_fields.append("current_odometer_km")
            if operating_hours is not None:
                vehicle.current_operating_hours = operating_hours
                update_fields.append("current_operating_hours")
        vehicle.save(update_fields=update_fields)


def _status_path(current_status: str, target_status: str) -> list[str]:
    if current_status == target_status:
        return []
    paths = {
        VehicleStatus.ANNOUNCED: {
            VehicleStatus.CHECKED_IN: [VehicleStatus.CHECKED_IN],
            VehicleStatus.AVAILABLE: [VehicleStatus.CHECKED_IN, VehicleStatus.AVAILABLE],
            VehicleStatus.DAMAGED: [VehicleStatus.CHECKED_IN, VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.CHECKED_IN, VehicleStatus.MAINTENANCE],
        },
        VehicleStatus.CHECKED_IN: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.LOANED: [VehicleStatus.AVAILABLE, VehicleStatus.LOANED],
            VehicleStatus.DAMAGED: [VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
        },
        VehicleStatus.AVAILABLE: {
            VehicleStatus.LOANED: [VehicleStatus.LOANED],
            VehicleStatus.DAMAGED: [VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.MANUFACTURER_CHECKOUT],
        },
        VehicleStatus.LOANED: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.DAMAGED: [VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
        },
        VehicleStatus.DAMAGED: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.MANUFACTURER_CHECKOUT],
        },
        VehicleStatus.MAINTENANCE: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.DAMAGED: [VehicleStatus.DAMAGED],
        },
        VehicleStatus.RESERVED: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.LOANED: [VehicleStatus.LOANED],
        },
    }
    try:
        return paths[current_status][target_status]
    except KeyError as exc:
        raise serializers.ValidationError(
            {"vehicle": [_("This workflow cannot move the vehicle to the requested status.")]}
        ) from exc


def _create_damage_reports(
    *,
    vehicle: Vehicle,
    actor,
    damage_payloads: Iterable[dict[str, Any]],
    workflow_phase: str = DamageWorkflowPhase.GENERAL,
    loan: Loan | None = None,
    check_in_protocol: CheckInProtocol | None = None,
    manufacturer_checkout_protocol: ManufacturerCheckOutProtocol | None = None,
    request_meta: dict[str, str] | None = None,
) -> list[DamageReport]:
    damages: list[DamageReport] = []
    for raw_payload in damage_payloads:
        payload = dict(raw_payload)
        existing_media = payload.pop("media_file_ids", [])
        discovered_at = payload.get("discovered_at") or timezone.now()
        if discovered_at > timezone.now():
            raise serializers.ValidationError({"damage_reports": [_("Damage discovery time cannot be in the future.")]})
        damage = DamageReport.objects.create(
            vehicle=vehicle,
            loan=loan,
            check_in_protocol=check_in_protocol,
            manufacturer_checkout_protocol=manufacturer_checkout_protocol,
            description=payload["description"],
            severity=payload.get("severity", "unknown"),
            workflow_phase=workflow_phase,
            discovered_at=discovered_at,
            created_by=actor,
        )
        _attach_media(
            vehicle=vehicle,
            loan=loan,
            damage_report=damage,
            related_type="damage_report",
            related_id=damage.id,
            existing_media=existing_media,
            actor=actor,
            allowed_types={MediaType.PHOTO},
            request_meta=request_meta,
        )
        audit_event(
            actor=actor,
            action="damage.created",
            entity_type="damage_report",
            entity_id=damage.id,
            after=_damage_snapshot(damage),
            request_meta=request_meta,
        )
        damages.append(damage)
    return damages


def _attach_media(
    *,
    vehicle: Vehicle,
    existing_media: Iterable[MediaFile],
    related_type: str,
    related_id,
    loan: Loan | None = None,
    damage_report: DamageReport | None = None,
    actor=None,
    allowed_types: set[str] | None = None,
    request_meta: dict[str, str] | None = None,
) -> list[MediaFile]:
    return attach_media_files(
        media_files=existing_media,
        actor=actor,
        vehicle=vehicle,
        loan=loan,
        damage_report=damage_report,
        related_type=related_type,
        related_id=related_id,
        allowed_types=allowed_types,
        request_meta=request_meta,
    )


def _vehicle_snapshot(vehicle: Vehicle) -> dict[str, Any]:
    return {
        "id": str(vehicle.id),
        "status": vehicle.status,
        "current_odometer_km": vehicle.current_odometer_km,
        "current_operating_hours": (
            str(vehicle.current_operating_hours) if vehicle.current_operating_hours is not None else None
        ),
    }


def _create_audit_log(
    *,
    actor,
    action: str,
    entity_type: str,
    entity_id,
    before: dict[str, Any],
    after: dict[str, Any],
    request_meta: dict[str, str],
) -> None:
    audit_event(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        request_meta=request_meta,
    )


def _validate_company(company, *, allowed_types: set[str], field: str, required: bool = False) -> None:
    if company is None:
        if required:
            raise serializers.ValidationError({field: [_("This company is required for the workflow.")]})
        return
    current = Company.objects.filter(pk=company.pk).only("is_active", "company_type").first()
    if current is None or not current.is_active:
        raise serializers.ValidationError({field: [_("The selected company is inactive.")]})
    if current.company_type not in allowed_types:
        raise serializers.ValidationError({field: [_("The selected company type is not valid for this workflow.")]})


def _request_fingerprint(data: dict[str, Any]) -> str:
    def normalize(value):
        if isinstance(value, dict):
            return {str(key): normalize(item) for key, item in sorted(value.items())}
        if isinstance(value, (list, tuple)):
            return [normalize(item) for item in value]
        if isinstance(value, Decimal):
            return str(value)
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if hasattr(value, "pk"):
            return str(value.pk)
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        return str(value)

    payload = json.dumps(normalize(data), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _validate_reservation_for_checkout(*, reservation: Reservation, vehicle: Vehicle, data: dict[str, Any]) -> None:
    now = timezone.now()
    if reservation.status != ReservationStatus.ACTIVE:
        raise serializers.ValidationError({"reservation_id": [_("Only an active reservation can be fulfilled.")]})
    if reservation.vehicle_id != vehicle.id:
        raise serializers.ValidationError(
            {"reservation_id": [_("The reservation belongs to a different vehicle.")]}
        )
    from datetime import timedelta

    earliest = reservation.start_at - timedelta(hours=RESERVATION_EARLY_HANDOVER_HOURS)
    if now < earliest:
        raise serializers.ValidationError(
            {"reservation_id": [_("This reservation is not yet within the early handover window.")]}
        )
    if now > reservation.end_at:
        raise serializers.ValidationError({"reservation_id": [_("This reservation window has ended.")]})
    if data["expected_return_at"] > reservation.end_at:
        raise serializers.ValidationError(
            {"expected_return_at": [_("Expected return must not be later than the reservation end.")]}
        )


def _prefill_or_validate_reservation_party(*, reservation: Reservation, data: dict[str, Any]) -> None:
    party = (reservation.snapshot or {}).get("party", {})
    expected_driver = reservation.driver_id
    expected_company = reservation.company_id or (reservation.driver.company_id if reservation.driver_id else None)
    expected_name = (
        party.get("name")
        or reservation.reserved_for
        or (str(reservation.driver) if reservation.driver_id else "")
    ).strip()
    expected_phone = (
        party.get("phone")
        or reservation.manual_phone
        or (reservation.driver.phone if reservation.driver_id else "")
    ).strip()
    if data.get("driver") and data["driver"].id != expected_driver:
        raise serializers.ValidationError({"driver": [_("The checkout driver does not match the reservation.")]})
    if expected_driver and not data.get("driver"):
        data["driver"] = reservation.driver
    if data.get("company") and data["company"].id != expected_company:
        raise serializers.ValidationError({"company": [_("The checkout company does not match the reservation.")]})
    if expected_company and not data.get("company"):
        data["company"] = Company.objects.get(pk=expected_company)
    supplied_name = (data.get("borrower_name") or "").strip()
    supplied_phone = (data.get("borrower_phone") or "").strip()
    if supplied_name and supplied_name.casefold() != expected_name.casefold():
        raise serializers.ValidationError(
            {"borrower_name": [_("The checkout borrower does not match the reservation snapshot.")]}
        )
    if supplied_phone and supplied_phone != expected_phone:
        raise serializers.ValidationError(
            {"borrower_phone": [_("The checkout phone does not match the reservation snapshot.")]}
        )
    data["borrower_name"] = expected_name
    data["borrower_phone"] = expected_phone


def _validate_reservation_checkout_conflicts(
    *,
    vehicle: Vehicle,
    expected_return_at,
    selected_reservation: Reservation | None,
) -> list[dict[str, str]]:
    from datetime import timedelta

    now = timezone.now()
    reservations = Reservation.objects.select_for_update().filter(
        vehicle=vehicle,
        status=ReservationStatus.ACTIVE,
        end_at__gt=now,
    )
    if selected_reservation:
        reservations = reservations.exclude(pk=selected_reservation.pk)
    block_until = now + timedelta(hours=RESERVATION_EARLY_HANDOVER_HOURS)
    blocking = reservations.filter(start_at__lte=block_until).order_by("start_at").first()
    if blocking:
        raise serializers.ValidationError(
            {
                "reservation_id": [
                    _("Checkout is blocked by a current or near-term reservation (%(id)s).")
                    % {"id": blocking.id}
                ]
            }
        )
    return [
        {
            "code": "reservation_before_expected_return",
            "reservation_id": str(item.id),
            "start_at": item.start_at.isoformat(),
        }
        for item in reservations.filter(start_at__lt=expected_return_at).order_by("start_at")[:5]
    ]


def _validate_driver(driver, *, company=None) -> None:
    if driver is None:
        return
    current = (
        type(driver)
        .objects.select_related("company")
        .filter(pk=driver.pk)
        .only("is_active", "company_id", "company__is_active", "company__company_type")
        .first()
    )
    if current is None or not current.is_active:
        raise serializers.ValidationError({"driver": [_("The selected driver is inactive.")]})
    if company is not None and current.company_id and current.company_id != company.id:
        raise serializers.ValidationError({"company": [_("The driver does not belong to the selected company.")]})
    if current.company_id and (
        not current.company.is_active
        or current.company.company_type not in {Company.CompanyType.SUBCONTRACTOR, Company.CompanyType.INTERNAL}
    ):
        raise serializers.ValidationError({"driver": [_("The driver's company is not active for loans.")]})


def _vehicle_protocol_snapshot(vehicle: Vehicle) -> dict[str, Any]:
    return {
        "id": str(vehicle.id),
        "internal_number": vehicle.internal_number,
        "category": {
            "id": str(vehicle.category_id),
            "name": vehicle.category.name,
        },
        "manufacturer": vehicle.manufacturer,
        "model": vehicle.model,
        "serial_number": vehicle.serial_number,
        "license_plate": vehicle.license_plate,
        "status": vehicle.status,
        "current_location": vehicle.current_location,
        "meter_mode": vehicle.category.meter_mode,
    }


def _user_protocol_snapshot(user) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
    }


def _company_snapshot(company) -> dict[str, Any] | None:
    if company is None:
        return None
    return {
        "id": str(company.id),
        "name": company.name,
        "company_type": company.company_type,
        "contact_name": company.contact_name,
        "phone": company.phone,
    }


def _damage_snapshot(damage: DamageReport) -> dict[str, Any]:
    media = MediaFile.objects.filter(damage_report=damage).order_by("created_at")
    return {
        "id": str(damage.id),
        "description": damage.description,
        "severity": damage.severity,
        "workflow_phase": damage.workflow_phase,
        "discovered_at": damage.discovered_at.isoformat(),
        "media": [_media_snapshot(item) for item in media],
    }


def _media_snapshot(media: MediaFile) -> dict[str, Any]:
    return {
        "id": str(media.id),
        "media_type": media.media_type,
        "original_filename": media.original_filename,
        "content_sha256": media.content_sha256,
    }


def _workflow_media(*, related_type: str, related_id) -> list[dict[str, Any]]:
    return [
        _media_snapshot(media)
        for media in MediaFile.objects.filter(related_type=related_type, related_id=related_id).order_by("created_at")
    ]


def _check_in_snapshot(
    *,
    protocol: CheckInProtocol,
    vehicle: Vehicle,
    damages,
    media=None,
    condition_outcome: str | None = None,
) -> dict[str, Any]:
    media_items = list(media) if media is not None else list(
        MediaFile.objects.filter(
            related_type="check_in_protocol",
            related_id=protocol.id,
        ).order_by("created_at")
    )
    return {
        "schema_version": 1,
        "workflow_type": "check_in",
        "record_id": str(protocol.id),
        "performed_at": protocol.performed_at.isoformat(),
        "performed_by": _user_protocol_snapshot(protocol.performed_by),
        "vehicle": _vehicle_protocol_snapshot(vehicle),
        "party": _company_snapshot(protocol.supplier_company),
        "readings": {
            "odometer_km": protocol.odometer_km,
            "operating_hours": str(protocol.operating_hours) if protocol.operating_hours is not None else None,
        },
        "notes": protocol.condition_notes,
        "condition_outcome": condition_outcome,
        "damages": [_damage_snapshot(item) for item in damages],
        "media": [_media_snapshot(item) for item in media_items],
        "signatures": [_media_snapshot(item) for item in media_items if item.media_type == MediaType.SIGNATURE],
    }


def _loan_snapshot(
    *,
    loan: Loan,
    vehicle: Vehicle,
    damages,
    phase: str,
    media,
    reservation: Reservation | None = None,
    condition_outcome: str | None = None,
) -> dict[str, Any]:
    is_return = phase == DamageWorkflowPhase.LOAN_RETURN
    return {
        "schema_version": 1,
        "workflow_type": phase,
        "record_id": str(loan.id),
        "performed_at": (loan.actual_return_at if is_return else loan.created_at).isoformat(),
        "performed_by": _user_protocol_snapshot(loan.returned_by if is_return else loan.created_by),
        "vehicle": _vehicle_protocol_snapshot(vehicle),
        "borrower": {
            "name": loan.borrower_name,
            "phone": loan.borrower_phone,
            "driver_id": str(loan.driver_id) if loan.driver_id else None,
            "company": _company_snapshot(loan.company),
            "expected_return_at": loan.expected_return_at.isoformat(),
            "actual_return_at": loan.actual_return_at.isoformat() if loan.actual_return_at else None,
        },
        "readings": {
            "odometer_km": loan.return_odometer_km if is_return else loan.checkout_odometer_km,
            "operating_hours": str(
                loan.return_operating_hours if is_return else loan.checkout_operating_hours
            )
            if (loan.return_operating_hours if is_return else loan.checkout_operating_hours) is not None
            else None,
        },
        "notes": loan.return_notes if is_return else loan.checkout_notes,
        "condition_outcome": condition_outcome if is_return else None,
        "reservation": reservation.snapshot if reservation else None,
        "damages": [_damage_snapshot(item) for item in damages],
        "media": [_media_snapshot(item) for item in media],
        "signatures": [_media_snapshot(item) for item in media if item.media_type == MediaType.SIGNATURE],
    }


def _manufacturer_snapshot(*, protocol, vehicle, damages, media) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "workflow_type": "manufacturer_checkout",
        "record_id": str(protocol.id),
        "performed_at": protocol.performed_at.isoformat(),
        "performed_by": _user_protocol_snapshot(protocol.performed_by),
        "vehicle": _vehicle_protocol_snapshot(vehicle),
        "party": _company_snapshot(protocol.recipient_company),
        "readings": {
            "odometer_km": protocol.odometer_km,
            "operating_hours": str(protocol.operating_hours) if protocol.operating_hours is not None else None,
        },
        "notes": protocol.condition_notes,
        "damages": [_damage_snapshot(item) for item in damages],
        "media": [_media_snapshot(item) for item in media],
        "signatures": [_media_snapshot(item) for item in media if item.media_type == MediaType.SIGNATURE],
    }


def _maintenance_snapshot(record: MaintenanceRecord, vehicle: Vehicle, media, *, completed: bool) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "workflow_type": "maintenance_complete" if completed else "maintenance_start",
        "record_id": str(record.id),
        "performed_at": (record.completed_at if completed else record.started_at).isoformat(),
        "performed_by": _user_protocol_snapshot(record.completed_by if completed else record.started_by),
        "vehicle": _vehicle_protocol_snapshot(vehicle),
        "reason": record.reason,
        "notes": record.completion_notes if completed else record.start_notes,
        "readings": {
            "odometer_km": record.completion_odometer_km if completed else record.start_odometer_km,
            "operating_hours": str(
                record.completion_operating_hours if completed else record.start_operating_hours
            )
            if (record.completion_operating_hours if completed else record.start_operating_hours) is not None
            else None,
        },
        "media": [_media_snapshot(item) for item in media],
    }

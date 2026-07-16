"""Transactional services for operational vehicle workflows."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from audit.services import audit_event
from damages.models import DamageReport, DamageWorkflowPhase
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import attach_media_files
from parties.models import Company
from vehicles.models import Vehicle, VehicleStatus
from workflows import pdf
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol

def _auto_generate_pdf(*, generator, record, error_field: str, actor, request_meta: dict[str, str]) -> None:
    """Generate a PDF and persist a visible, audited failure when it fails."""
    try:
        generator()
    except Exception as exc:  # noqa: BLE001 - workflow completion remains authoritative
        message = str(exc)[:1000] or exc.__class__.__name__
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
) -> CheckInProtocol:
    """Create a check-in protocol and update the vehicle in one transaction."""
    request_meta = request_meta or {}
    request_fingerprint = _request_fingerprint(data)
    with transaction.atomic():
        if idempotency_key:
            existing = CheckInProtocol.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
            if existing:
                if (
                    existing.performed_by_id != actor.id
                    or existing.vehicle_id != data["vehicle"].id
                    or existing.request_fingerprint != request_fingerprint
                ):
                    raise serializers.ValidationError(
                        {"idempotency_key": [_("This idempotency key was already used for another request.")]}
                    )
                existing._idempotent_replay = True
                return existing
        vehicle = _locked_vehicle(data["vehicle"])
        if idempotency_key:
            existing = CheckInProtocol.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                if (
                    existing.performed_by_id != actor.id
                    or existing.vehicle_id != vehicle.id
                    or existing.request_fingerprint != request_fingerprint
                ):
                    raise serializers.ValidationError(
                        {"idempotency_key": [_("This idempotency key was already used for another request.")]}
                    )
                existing._idempotent_replay = True
                return existing
        before = _vehicle_snapshot(vehicle)
        if vehicle.status != VehicleStatus.ANNOUNCED:
            raise serializers.ValidationError({"vehicle": [_("Only announced vehicles can be checked in.")]})
        _validate_company(
            data.get("supplier_company"),
            allowed_types={Company.CompanyType.SUPPLIER, Company.CompanyType.MANUFACTURER},
            field="supplier_company",
        )
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )

        damage_payloads = data.get("damage_reports", [])
        target_status = data.get("target_status") or (
            VehicleStatus.DAMAGED if damage_payloads else VehicleStatus.AVAILABLE
        )
        protocol = CheckInProtocol.objects.create(
            vehicle=vehicle,
            performed_by=actor,
            performed_at=data.get("performed_at") or timezone.now(),
            supplier_company=data.get("supplier_company"),
            odometer_km=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            condition_notes=data.get("condition_notes", ""),
            idempotency_key=idempotency_key,
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
        _attach_media(
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
        protocol.snapshot = _check_in_snapshot(protocol=protocol, vehicle=vehicle, damages=damages)
        protocol.save(update_fields=["snapshot", "updated_at"])
        _auto_generate_pdf(
            generator=lambda: pdf.generate_check_in_pdf(
                protocol=protocol, actor=actor, language=language, request_meta=request_meta
            ),
            record=protocol,
            error_field="pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
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
        return protocol


def complete_loan_checkout(
    *, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None, language: str | None = None
) -> Loan:
    """Create an active loan and mark the vehicle loaned atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        vehicle = _locked_vehicle(data["vehicle"])
        before = _vehicle_snapshot(vehicle)
        if vehicle.status != VehicleStatus.AVAILABLE:
            raise serializers.ValidationError({"vehicle": [_("Only available vehicles can be loaned.")]})
        if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
            raise serializers.ValidationError({"vehicle": [_("This vehicle already has an active loan.")]})
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
        )
        loan.save(update_fields=["checkout_snapshot", "updated_at"])
        _auto_generate_pdf(
            generator=lambda: pdf.generate_loan_checkout_pdf(
                loan=loan, actor=actor, language=language, request_meta=request_meta
            ),
            record=loan,
            error_field="checkout_pdf_generation_error",
            actor=actor,
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
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
            odometer_field="return_odometer_km",
            hours_field="return_operating_hours",
        )

        damage_payloads = data.get("damage_reports", [])
        target_status = data.get("target_status") or (
            VehicleStatus.DAMAGED if damage_payloads else VehicleStatus.AVAILABLE
        )
        locked_loan.return_odometer_km = data.get("return_odometer_km")
        locked_loan.return_operating_hours = data.get("return_operating_hours")
        locked_loan.return_notes = data.get("return_notes", "")
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
        _transition_vehicle(
            vehicle,
            target_status=target_status,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
        )
        locked_loan.return_snapshot = _loan_snapshot(
            loan=locked_loan,
            vehicle=vehicle,
            damages=damages,
            phase=DamageWorkflowPhase.LOAN_RETURN,
            media=attached,
        )
        locked_loan.save(update_fields=["return_snapshot", "updated_at"])
        _auto_generate_pdf(
            generator=lambda: pdf.generate_loan_return_pdf(
                loan=locked_loan, actor=actor, language=language, request_meta=request_meta
            ),
            record=locked_loan,
            error_field="return_pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
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
                {"vehicle": [_("Loaned vehicles cannot be checked out to manufacturers.")]}
            )
        if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
            raise serializers.ValidationError(
                {"vehicle": [_("Vehicles with an active loan cannot be checked out to manufacturers.")]}
            )
        if vehicle.status in {VehicleStatus.ANNOUNCED, VehicleStatus.MANUFACTURER_CHECKOUT, VehicleStatus.ARCHIVED}:
            raise serializers.ValidationError(
                {"vehicle": [_("This vehicle cannot be checked out to manufacturers from its current status.")]}
            )
        _validate_company(
            data.get("recipient_company"),
            allowed_types={Company.CompanyType.MANUFACTURER, Company.CompanyType.SUPPLIER},
            field="recipient_company",
        )
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
            odometer_field="odometer_km",
            hours_field="operating_hours",
        )

        protocol = ManufacturerCheckOutProtocol.objects.create(
            vehicle=vehicle,
            performed_by=actor,
            performed_at=data.get("performed_at") or timezone.now(),
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
        _auto_generate_pdf(
            generator=lambda: pdf.generate_manufacturer_checkout_pdf(
                protocol=protocol, actor=actor, language=language, request_meta=request_meta
            ),
            record=protocol,
            error_field="pdf_generation_error",
            actor=actor,
            request_meta=request_meta,
        )
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
        return protocol


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
            VehicleStatus.DAMAGED: [VehicleStatus.CHECKED_IN, VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.CHECKED_IN, VehicleStatus.AVAILABLE, VehicleStatus.MAINTENANCE],
        },
        VehicleStatus.CHECKED_IN: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.LOANED: [VehicleStatus.AVAILABLE, VehicleStatus.LOANED],
            VehicleStatus.DAMAGED: [VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.AVAILABLE, VehicleStatus.MAINTENANCE],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.AVAILABLE, VehicleStatus.MANUFACTURER_CHECKOUT],
        },
        VehicleStatus.AVAILABLE: {
            VehicleStatus.LOANED: [VehicleStatus.LOANED],
            VehicleStatus.DAMAGED: [VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.MANUFACTURER_CHECKOUT],
        },
        VehicleStatus.LOANED: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.DAMAGED: [VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED],
            VehicleStatus.MAINTENANCE: [VehicleStatus.AVAILABLE, VehicleStatus.MAINTENANCE],
        },
        VehicleStatus.DAMAGED: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.MAINTENANCE: [VehicleStatus.MAINTENANCE],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.AVAILABLE, VehicleStatus.MANUFACTURER_CHECKOUT],
        },
        VehicleStatus.MAINTENANCE: {
            VehicleStatus.AVAILABLE: [VehicleStatus.AVAILABLE],
            VehicleStatus.DAMAGED: [VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED],
            VehicleStatus.MANUFACTURER_CHECKOUT: [VehicleStatus.AVAILABLE, VehicleStatus.MANUFACTURER_CHECKOUT],
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


def _validate_company(company, *, allowed_types: set[str], field: str) -> None:
    if company is None:
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


def _check_in_snapshot(*, protocol: CheckInProtocol, vehicle: Vehicle, damages) -> dict[str, Any]:
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
        "damages": [_damage_snapshot(item) for item in damages],
        "media": _workflow_media(related_type="check_in_protocol", related_id=protocol.id),
    }


def _loan_snapshot(*, loan: Loan, vehicle: Vehicle, damages, phase: str, media) -> dict[str, Any]:
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
    }

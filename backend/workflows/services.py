"""Transactional services for operational vehicle workflows."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from audit.models import AuditLog
from damages.models import DamageReport, DamageWorkflowPhase
from mediafiles.models import MediaFile
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol


def complete_check_in(*, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None) -> CheckInProtocol:
    """Create a check-in protocol and update the vehicle in one transaction."""
    request_meta = request_meta or {}
    with transaction.atomic():
        vehicle = _locked_vehicle(data["vehicle"])
        before = _vehicle_snapshot(vehicle)
        _ensure_status(
            vehicle,
            disallowed={VehicleStatus.LOANED, VehicleStatus.MANUFACTURER_CHECKOUT, VehicleStatus.ARCHIVED},
            message=_("This vehicle cannot be checked in from its current status."),
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
        )
        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=damage_payloads,
            workflow_phase=DamageWorkflowPhase.CHECK_IN,
            check_in_protocol=protocol,
        )
        _attach_media(
            vehicle=vehicle,
            related_type="check_in_protocol",
            related_id=protocol.id,
            existing_media=data.get("media_file_ids", []),
        )
        _transition_vehicle(
            vehicle,
            target_status=target_status,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
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


def complete_loan_checkout(*, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None) -> Loan:
    """Create an active loan and mark the vehicle loaned atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        vehicle = _locked_vehicle(data["vehicle"])
        before = _vehicle_snapshot(vehicle)
        if vehicle.status not in {VehicleStatus.AVAILABLE, VehicleStatus.CHECKED_IN}:
            raise serializers.ValidationError(
                {"vehicle": [_("Only available or checked-in vehicles can be loaned.")]}
            )
        if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
            raise serializers.ValidationError({"vehicle": [_("This vehicle already has an active loan.")]})
        _validate_readings_do_not_decrease(
            vehicle,
            odometer=data.get("checkout_odometer_km"),
            operating_hours=data.get("checkout_operating_hours"),
            odometer_field="checkout_odometer_km",
            hours_field="checkout_operating_hours",
        )

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
        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=data.get("damage_reports", []),
            workflow_phase=DamageWorkflowPhase.LOAN_CHECKOUT,
            loan=loan,
        )
        _attach_media(
            vehicle=vehicle,
            loan=loan,
            related_type="loan_checkout",
            related_id=loan.id,
            existing_media=data.get("media_file_ids", []),
        )
        _transition_vehicle(
            vehicle,
            target_status=VehicleStatus.LOANED,
            odometer=data.get("checkout_odometer_km"),
            operating_hours=data.get("checkout_operating_hours"),
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
    *, loan: Loan, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None
) -> Loan:
    """Close a referenced active loan and update the vehicle atomically."""
    request_meta = request_meta or {}
    with transaction.atomic():
        locked_loan = Loan.objects.select_for_update().select_related("vehicle").get(pk=loan.pk)
        if locked_loan.status != LoanStatus.ACTIVE:
            raise serializers.ValidationError({"loan": [_("Loan return requires an active loan.")]})
        vehicle = _locked_vehicle(locked_loan.vehicle)
        before = _vehicle_snapshot(vehicle)
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
        locked_loan.actual_return_at = data.get("actual_return_at") or timezone.now()
        locked_loan.status = LoanStatus.RETURNED
        locked_loan.returned_by = actor
        locked_loan.save()

        damages = _create_damage_reports(
            vehicle=vehicle,
            actor=actor,
            damage_payloads=damage_payloads,
            workflow_phase=DamageWorkflowPhase.LOAN_RETURN,
            loan=locked_loan,
        )
        _attach_media(
            vehicle=vehicle,
            loan=locked_loan,
            related_type="loan_return",
            related_id=locked_loan.id,
            existing_media=data.get("media_file_ids", []),
        )
        _transition_vehicle(
            vehicle,
            target_status=target_status,
            odometer=data.get("return_odometer_km"),
            operating_hours=data.get("return_operating_hours"),
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
    *, data: dict[str, Any], actor, request_meta: dict[str, str] | None = None
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
        if vehicle.status in {VehicleStatus.ANNOUNCED, VehicleStatus.MANUFACTURER_CHECKOUT, VehicleStatus.ARCHIVED}:
            raise serializers.ValidationError(
                {"vehicle": [_("This vehicle cannot be checked out to manufacturers from its current status.")]}
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
        )
        _attach_media(
            vehicle=vehicle,
            related_type="manufacturer_checkout_protocol",
            related_id=protocol.id,
            existing_media=data.get("media_file_ids", []),
        )
        _transition_vehicle(
            vehicle,
            target_status=VehicleStatus.MANUFACTURER_CHECKOUT,
            odometer=data.get("odometer_km"),
            operating_hours=data.get("operating_hours"),
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
) -> list[DamageReport]:
    damages: list[DamageReport] = []
    for payload in damage_payloads:
        existing_media = payload.pop("media_file_ids", [])
        damage = DamageReport.objects.create(
            vehicle=vehicle,
            loan=loan,
            check_in_protocol=check_in_protocol,
            manufacturer_checkout_protocol=manufacturer_checkout_protocol,
            description=payload["description"],
            severity=payload.get("severity", "unknown"),
            workflow_phase=workflow_phase,
            discovered_at=payload.get("discovered_at") or timezone.now(),
            created_by=actor,
        )
        _attach_media(
            vehicle=vehicle,
            loan=loan,
            damage_report=damage,
            related_type="damage_report",
            related_id=damage.id,
            existing_media=existing_media,
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
) -> None:
    # Attach already-uploaded media (real stored files) to the workflow record.
    for media in existing_media:
        media.vehicle = vehicle
        media.loan = loan
        media.damage_report = damage_report
        media.related_type = related_type
        media.related_id = related_id
        media.save(update_fields=["vehicle", "loan", "damage_report", "related_type", "related_id", "updated_at"])


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
    AuditLog.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        ip_address=request_meta.get("ip_address") or None,
        user_agent=request_meta.get("user_agent", ""),
    )

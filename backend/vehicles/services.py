"""Transactional vehicle master-data creation."""

from __future__ import annotations

from django.db import transaction
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from django.utils import timezone

from audit.services import audit_event
from damages.models import DamageReport, DamageSeverity, DamageWorkflowPhase
from mediafiles.models import MediaType
from mediafiles.services import attach_media_files
from vehicles.models import Vehicle, VehicleStatus


@transaction.atomic
def create_vehicle_with_condition(*, data: dict, actor, request_meta: dict[str, str] | None = None) -> Vehicle:
    """Create an announced vehicle with initial evidence atomically."""

    values = dict(data)
    damage_payloads = values.pop("initial_damage_reports", [])
    vehicle_media = values.pop("media_file_ids", [])
    # Arrival state is workflow-owned. Client input can never place a newly
    # created/imported record directly in the available pool.
    values.pop("status", None)
    values["status"] = VehicleStatus.ANNOUNCED
    vehicle = Vehicle.objects.create(**values)

    attach_media_files(
        media_files=vehicle_media,
        actor=actor,
        vehicle=vehicle,
        related_type="vehicle",
        related_id=vehicle.id,
        allowed_types={MediaType.PHOTO},
        request_meta=request_meta,
    )
    damage_ids = []
    for raw_payload in damage_payloads:
        payload = dict(raw_payload)
        media_ids = payload.pop("media_file_ids", [])
        damage = DamageReport.objects.create(
            vehicle=vehicle,
            description=payload["description"],
            severity=payload.get("severity", DamageSeverity.UNKNOWN),
            workflow_phase=DamageWorkflowPhase.GENERAL,
            discovered_at=timezone.now(),
            created_by=actor,
        )
        attach_media_files(
            media_files=media_ids,
            actor=actor,
            vehicle=vehicle,
            damage_report=damage,
            related_type="damage_report",
            related_id=damage.id,
            allowed_types={MediaType.PHOTO},
            request_meta=request_meta,
        )
        damage_ids.append(str(damage.id))
        audit_event(
            actor=actor,
            action="damage.created",
            entity_type="damage_report",
            entity_id=damage.id,
            after={"vehicle_id": str(vehicle.id), "severity": damage.severity},
            request_meta=request_meta,
        )

    audit_event(
        actor=actor,
        action="vehicle.created",
        entity_type="vehicle",
        entity_id=vehicle.id,
        after={
            "internal_number": vehicle.internal_number,
            "status": vehicle.status,
            "initial_damage_ids": damage_ids,
        },
        request_meta=request_meta,
    )
    return vehicle


@transaction.atomic
def archive_vehicle(*, vehicle: Vehicle, reason: str, actor, request_meta=None) -> Vehicle:
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    if vehicle.status == VehicleStatus.ARCHIVED:
        raise serializers.ValidationError({"vehicle": [_("This vehicle is already archived.")]})
    if vehicle.status != VehicleStatus.MANUFACTURER_CHECKOUT:
        raise serializers.ValidationError(
            {"vehicle": [_("Only a vehicle returned to its manufacturer may be archived.")]}
        )
    if not reason.strip():
        raise serializers.ValidationError({"reason": [_("An archive reason is required.")]})
    before = _vehicle_admin_snapshot(vehicle)
    vehicle.archive_previous_status = vehicle.status
    vehicle.status = VehicleStatus.ARCHIVED
    vehicle.archived_at = timezone.now()
    vehicle.archived_by = actor
    vehicle.archive_reason = reason.strip()
    vehicle.save()
    audit_event(
        actor=actor,
        action="vehicle.archived",
        entity_type="vehicle",
        entity_id=vehicle.id,
        before=before,
        after=_vehicle_admin_snapshot(vehicle),
        request_meta=request_meta,
    )
    return vehicle


@transaction.atomic
def unarchive_vehicle(*, vehicle: Vehicle, reason: str, actor, request_meta=None) -> Vehicle:
    """Audited correction only; never silently reintroduce an unsafe vehicle."""

    from workflows.models import Loan, LoanStatus, MaintenanceRecord, MaintenanceStatus

    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    if vehicle.status != VehicleStatus.ARCHIVED:
        raise serializers.ValidationError({"vehicle": [_("Only archived vehicles can be restored.")]})
    if not reason.strip():
        raise serializers.ValidationError({"reason": [_("A correction reason is required.")]})
    if Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists():
        raise serializers.ValidationError({"vehicle": [_("A vehicle with an active loan cannot be restored.")]})
    if MaintenanceRecord.objects.select_for_update().filter(
        vehicle=vehicle, status=MaintenanceStatus.ACTIVE
    ).exists():
        raise serializers.ValidationError({"vehicle": [_("A vehicle under maintenance cannot be restored.")]})
    target = vehicle.archive_previous_status or VehicleStatus.MANUFACTURER_CHECKOUT
    if target != VehicleStatus.MANUFACTURER_CHECKOUT:
        raise serializers.ValidationError(
            {"vehicle": [_("The recorded pre-archive state is not safe for automatic restoration.")]}
        )
    before = _vehicle_admin_snapshot(vehicle)
    vehicle.status = target
    vehicle.archived_at = None
    vehicle.archived_by = None
    vehicle.archive_reason = ""
    vehicle.archive_previous_status = ""
    vehicle._allow_archive_correction = True
    vehicle.save()
    audit_event(
        actor=actor,
        action="vehicle.unarchived",
        entity_type="vehicle",
        entity_id=vehicle.id,
        before=before,
        after={**_vehicle_admin_snapshot(vehicle), "correction_reason": reason.strip()},
        request_meta=request_meta,
    )
    return vehicle


@transaction.atomic
def correct_vehicle_state(
    *,
    vehicle: Vehicle,
    reason: str,
    actor,
    status: str | None = None,
    odometer_km=None,
    operating_hours=None,
    request_meta=None,
) -> Vehicle:
    """Explicit admin correction with relationship-aware safety checks."""

    from damages.models import DamageReport
    from workflows.models import Loan, LoanStatus, MaintenanceRecord, MaintenanceStatus

    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    if not reason.strip():
        raise serializers.ValidationError({"reason": [_("A correction reason is required.")]})
    target = status or vehicle.status
    if target in {VehicleStatus.LOANED, VehicleStatus.MANUFACTURER_CHECKOUT, VehicleStatus.ARCHIVED}:
        raise serializers.ValidationError({"status": [_("This state can only be entered through its workflow.")]})
    active_loan = Loan.objects.select_for_update().filter(vehicle=vehicle, status=LoanStatus.ACTIVE).exists()
    active_maintenance = MaintenanceRecord.objects.select_for_update().filter(
        vehicle=vehicle, status=MaintenanceStatus.ACTIVE
    ).exists()
    open_damage = DamageReport.objects.select_for_update().filter(
        vehicle=vehicle, resolved_at__isnull=True
    ).exists()
    if active_loan and target != VehicleStatus.LOANED:
        raise serializers.ValidationError({"status": [_("Return the active loan before correcting status.")]})
    if active_maintenance and target != VehicleStatus.MAINTENANCE:
        raise serializers.ValidationError({"status": [_("Complete active maintenance before correcting status.")]})
    if open_damage and target == VehicleStatus.AVAILABLE:
        raise serializers.ValidationError({"status": [_("Resolve open damage before correcting status to available.")]})
    before = _vehicle_admin_snapshot(vehicle)
    vehicle.status = target
    if odometer_km is not None:
        vehicle.current_odometer_km = odometer_km
    if operating_hours is not None:
        vehicle.current_operating_hours = operating_hours
    vehicle._allow_meter_correction = True
    vehicle.save()
    audit_event(
        actor=actor,
        action="vehicle.admin_corrected",
        entity_type="vehicle",
        entity_id=vehicle.id,
        before=before,
        after={**_vehicle_admin_snapshot(vehicle), "correction_reason": reason.strip()},
        request_meta=request_meta,
    )
    return vehicle


def _vehicle_admin_snapshot(vehicle: Vehicle) -> dict:
    return {
        "status": vehicle.status,
        "odometer_km": vehicle.current_odometer_km,
        "operating_hours": (
            str(vehicle.current_operating_hours) if vehicle.current_operating_hours is not None else None
        ),
        "archived_at": vehicle.archived_at.isoformat() if vehicle.archived_at else None,
        "archived_by": str(vehicle.archived_by_id) if vehicle.archived_by_id else None,
        "archive_reason": vehicle.archive_reason,
    }

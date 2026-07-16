"""Transactional vehicle master-data creation."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from audit.services import audit_event
from damages.models import DamageReport, DamageSeverity, DamageWorkflowPhase
from mediafiles.models import MediaType
from mediafiles.services import attach_media_files
from vehicles.models import Vehicle, VehicleStatus


@transaction.atomic
def create_vehicle_with_condition(*, data: dict, actor, request_meta: dict[str, str] | None = None) -> Vehicle:
    """Create a vehicle, initial damages, and staged photos atomically."""

    values = dict(data)
    damage_payloads = values.pop("initial_damage_reports", [])
    vehicle_media = values.pop("media_file_ids", [])
    values["status"] = VehicleStatus.DAMAGED if damage_payloads else values.get("status", VehicleStatus.ANNOUNCED)
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

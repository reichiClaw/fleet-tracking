"""Damage report API viewsets."""

from django.utils import timezone
from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from audit.services import audit_event
from config.request import request_metadata
from damages.models import DamageReport, DamageWorkflowPhase
from damages.serializers import DamageReportSerializer, DamageResolutionSerializer
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import Loan, LoanStatus, MaintenanceRecord, MaintenanceStatus


class DamageReportViewSet(viewsets.ModelViewSet):
    queryset = DamageReport.objects.select_related(
        "vehicle", "loan", "check_in_protocol", "manufacturer_checkout_protocol", "created_by"
    ).all()
    serializer_class = DamageReportSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        vehicle = Vehicle.objects.select_for_update().get(pk=serializer.validated_data["vehicle"].pk)
        damage = serializer.save(
            vehicle=vehicle,
            created_by=self.request.user,
            workflow_phase=DamageWorkflowPhase.GENERAL,
        )
        if vehicle.status == VehicleStatus.AVAILABLE:
            before_status = vehicle.status
            vehicle.status = VehicleStatus.DAMAGED
            vehicle.save(update_fields=["status", "updated_at"])
            audit_event(
                actor=self.request.user,
                action="vehicle.status_changed",
                entity_type="vehicle",
                entity_id=vehicle.id,
                before={"status": before_status},
                after={"status": vehicle.status, "damage_report_id": str(damage.id)},
                request_meta=request_metadata(self.request),
            )
        audit_event(
            actor=self.request.user,
            action="damage.created",
            entity_type="damage_report",
            entity_id=damage.id,
            after=_damage_snapshot(damage),
            request_meta=request_metadata(self.request),
        )

    def perform_update(self, serializer):
        before = _damage_snapshot(serializer.instance)
        damage = serializer.save()
        audit_event(
            actor=self.request.user,
            action="damage.updated",
            entity_type="damage_report",
            entity_id=damage.id,
            before=before,
            after=_damage_snapshot(damage),
            request_meta=request_metadata(self.request),
        )

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        resolution = DamageResolutionSerializer(data=request.data)
        resolution.is_valid(raise_exception=True)
        with transaction.atomic():
            candidate = self.get_object()
            vehicle = Vehicle.objects.select_for_update().get(pk=candidate.vehicle_id)
            damage = self.get_queryset().select_for_update().get(pk=candidate.pk)
            before = _damage_snapshot(damage)
            if damage.resolved_at is None:
                damage.resolved_at = timezone.now()
                damage.resolved_by = request.user
                damage.resolution_notes = resolution.validated_data.get("resolution_notes", "")
                damage.save(update_fields=["resolved_at", "resolved_by", "resolution_notes", "updated_at"])
                audit_event(
                    actor=request.user,
                    action="damage.resolved",
                    entity_type="damage_report",
                    entity_id=damage.id,
                    before=before,
                    after=_damage_snapshot(damage),
                    request_meta=request_metadata(request),
                )
                if (
                    vehicle.status == VehicleStatus.DAMAGED
                    and not DamageReport.objects.filter(
                        vehicle=vehicle,
                        resolved_at__isnull=True,
                    ).exists()
                    and not Loan.objects.select_for_update().filter(
                        vehicle=vehicle,
                        status=LoanStatus.ACTIVE,
                    ).exists()
                    and not MaintenanceRecord.objects.select_for_update().filter(
                        vehicle=vehicle,
                        status=MaintenanceStatus.ACTIVE,
                    ).exists()
                ):
                    before_status = vehicle.status
                    vehicle.status = VehicleStatus.AVAILABLE
                    vehicle.save(update_fields=["status", "updated_at"])
                    audit_event(
                        actor=request.user,
                        action="vehicle.status_changed",
                        entity_type="vehicle",
                        entity_id=vehicle.id,
                        before={"status": before_status},
                        after={"status": vehicle.status, "resolved_damage_report_id": str(damage.id)},
                        request_meta=request_metadata(request),
                    )
        return Response(self.get_serializer(damage).data)


def _damage_snapshot(damage):
    return {
        "vehicle_id": str(damage.vehicle_id),
        "description": damage.description,
        "severity": damage.severity,
        "workflow_phase": damage.workflow_phase,
        "resolved_at": damage.resolved_at.isoformat() if damage.resolved_at else None,
        "resolved_by_id": str(damage.resolved_by_id) if damage.resolved_by_id else None,
    }

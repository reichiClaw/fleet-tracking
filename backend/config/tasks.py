"""Operator task feed built from server-side workflow state."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from mediafiles.views import _document_register_rows
from damages.models import DamageReport
from vehicles.capabilities import vehicle_capabilities
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import Loan, LoanStatus, Reservation, ReservationStatus


class OperatorTaskView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        try:
            limit = min(max(int(request.query_params.get("limit", 25)), 1), 100)
        except ValueError:
            limit = 25

        def vehicle_task(vehicle, action, url, *, due_at=None, related_id=None, method="POST"):
            return {
                "vehicle_id": str(vehicle.id),
                "related_id": str(related_id) if related_id else None,
                "label": " · ".join(
                    value for value in (vehicle.internal_number, vehicle.manufacturer, vehicle.model) if value
                ),
                "status": vehicle.status,
                "due_at": due_at.isoformat() if due_at else None,
                "next_action": {"action": action, "url": url, "method": method},
                "capabilities": vehicle_capabilities(vehicle, request.user),
            }

        arrivals_qs = Vehicle.objects.select_related("category").filter(status=VehicleStatus.ANNOUNCED)
        overdue_qs = (
            Loan.objects.select_related("vehicle", "vehicle__category")
            .filter(status=LoanStatus.ACTIVE, expected_return_at__lt=now)
            .order_by("expected_return_at")
        )
        reservation_qs = (
            Reservation.objects.select_related("vehicle", "vehicle__category")
            .filter(
                status=ReservationStatus.ACTIVE,
                start_at__lte=now + timedelta(hours=int(settings.RESERVATION_EARLY_HANDOVER_HOURS)),
                end_at__gte=now,
            )
            .order_by("start_at")
        )
        condition_qs = (
            Vehicle.objects.select_related("category")
            .prefetch_related(
                Prefetch(
                    "damage_reports",
                    queryset=DamageReport.objects.filter(resolved_at__isnull=True).order_by("discovered_at"),
                    to_attr="_task_open_damages",
                )
            )
            .filter(status__in=[VehicleStatus.DAMAGED, VehicleStatus.MAINTENANCE])
        )
        manufacturer_qs = (
            Vehicle.objects.select_related("category")
            .filter(
                manufacturer_return_due__lte=now.date(),
                status__in=[VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED],
            )
            .order_by("manufacturer_return_due")
        )
        failed_documents = [row for row in _document_register_rows() if row["status"] == "failed"]

        groups = {
            "arrivals_awaiting_check_in": {
                "count": arrivals_qs.count(),
                "items": [
                    vehicle_task(
                        vehicle,
                        "check_in",
                        "/api/v1/workflows/check-ins/",
                    )
                    for vehicle in arrivals_qs.order_by("created_at")[:limit]
                ],
            },
            "overdue_returns": {
                "count": overdue_qs.count(),
                "items": [
                    vehicle_task(
                        loan.vehicle,
                        "loan_return",
                        f"/api/v1/loans/{loan.id}/return/",
                        due_at=loan.expected_return_at,
                        related_id=loan.id,
                    )
                    for loan in overdue_qs[:limit]
                ],
            },
            "reservation_handovers": {
                "count": reservation_qs.count(),
                "items": [
                    vehicle_task(
                        reservation.vehicle,
                        "loan_checkout",
                        "/api/v1/loans/",
                        due_at=reservation.start_at,
                        related_id=reservation.id,
                    )
                    for reservation in reservation_qs[:limit]
                ],
            },
            "condition_attention": {
                "count": condition_qs.count(),
                "items": [
                    vehicle_task(
                        vehicle,
                        (
                            "maintenance_complete"
                            if vehicle.status == VehicleStatus.MAINTENANCE
                            else "resolve_damage"
                            if vehicle._task_open_damages
                            else "condition_review"
                        ),
                        (
                            f"/api/v1/vehicles/{vehicle.id}/complete-maintenance/"
                            if vehicle.status == VehicleStatus.MAINTENANCE
                            else f"/api/v1/damage-reports/{vehicle._task_open_damages[0].id}/resolve/"
                            if vehicle._task_open_damages
                            else f"/api/v1/vehicles/{vehicle.id}/history/"
                        ),
                        related_id=(
                            vehicle._task_open_damages[0].id
                            if vehicle.status == VehicleStatus.DAMAGED and vehicle._task_open_damages
                            else None
                        ),
                        method=(
                            "GET"
                            if vehicle.status == VehicleStatus.DAMAGED and not vehicle._task_open_damages
                            else "POST"
                        ),
                    )
                    for vehicle in condition_qs.order_by("status", "internal_number")[:limit]
                ],
            },
            "failed_documents": {
                "count": len(failed_documents),
                "items": failed_documents[:limit],
            },
            "manufacturer_returns_due": {
                "count": manufacturer_qs.count(),
                "items": [
                    vehicle_task(
                        vehicle,
                        "manufacturer_return",
                        "/api/v1/workflows/manufacturer-returns/",
                        due_at=vehicle.manufacturer_return_due,
                    )
                    for vehicle in manufacturer_qs[:limit]
                ],
            },
        }
        return Response(
            {
                "generated_at": now.isoformat(),
                "count": sum(group["count"] for group in groups.values()),
                "groups": groups,
            }
        )

"""Aggregated metrics for the operational dashboard.

A single, efficient endpoint that powers the dashboard so the SPA does not have
to page through list endpoints (which would cap counts at the page size) or run
many round-trips. All metrics use database aggregation and avoid N+1 queries.
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import Loan, LoanStatus

CHECKOUT_SERIES_DAYS = 14


def _vehicle_label(vehicle: Vehicle) -> str:
    return " · ".join(part for part in (vehicle.internal_number, vehicle.manufacturer, vehicle.model) if part)


def _borrower(loan: Loan) -> str:
    if loan.driver_id and loan.driver:
        name = f"{loan.driver.first_name} {loan.driver.last_name}".strip()
        if name:
            return name
    return loan.borrower_name or ""


class DashboardSummaryView(APIView):
    """Return aggregated, permission-safe fleet metrics for the dashboard."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.now()

        status_counts = {
            row["status"]: row["count"]
            for row in Vehicle.objects.values("status").annotate(count=Count("id"))
        }

        def count_for(status_value: str) -> int:
            return status_counts.get(status_value, 0)

        total_vehicles = sum(status_counts.values())
        operational = total_vehicles - count_for(VehicleStatus.ARCHIVED) - count_for(VehicleStatus.MANUFACTURER_CHECKOUT)
        loaned = count_for(VehicleStatus.LOANED)
        utilization = round((loaned / operational) * 100) if operational else 0

        active_loans = Loan.objects.filter(status=LoanStatus.ACTIVE).count()
        overdue_qs = Loan.objects.filter(status=LoanStatus.ACTIVE, expected_return_at__lt=now)

        # Loan checkouts per day for the trailing window (real activity series).
        series_start = (now - timedelta(days=CHECKOUT_SERIES_DAYS - 1)).date()
        series_counts = {
            row["day"]: row["count"]
            for row in (
                Loan.objects.filter(created_at__date__gte=series_start)
                .annotate(day=TruncDate("created_at"))
                .values("day")
                .annotate(count=Count("id"))
            )
        }
        checkouts_series = [
            {"date": (series_start + timedelta(days=offset)).isoformat(),
             "count": series_counts.get(series_start + timedelta(days=offset), 0)}
            for offset in range(CHECKOUT_SERIES_DAYS)
        ]

        category_rows = (
            VehicleCategory.objects.filter(is_active=True)
            .annotate(
                total=Count("vehicles"),
                available=Count("vehicles", filter=Q(vehicles__status=VehicleStatus.AVAILABLE)),
            )
            .order_by("name")
        )
        available_by_category = [
            {"id": str(category.id), "name": category.name, "total": category.total, "available": category.available}
            for category in category_rows
            if category.total > 0
        ]

        recent_loans = [
            {
                "id": str(loan.id),
                "vehicle_label": _vehicle_label(loan.vehicle),
                "borrower": _borrower(loan),
                "status": loan.status,
                "created_at": loan.created_at.isoformat() if loan.created_at else None,
                "expected_return_at": loan.expected_return_at.isoformat() if loan.expected_return_at else None,
            }
            for loan in Loan.objects.select_related("vehicle", "driver").order_by("-created_at")[:6]
        ]

        overdue_loans_list = [
            {
                "id": str(loan.id),
                "vehicle_label": _vehicle_label(loan.vehicle),
                "borrower": _borrower(loan),
                "expected_return_at": loan.expected_return_at.isoformat(),
            }
            for loan in overdue_qs.select_related("vehicle", "driver").order_by("expected_return_at")[:5]
        ]
        damaged_vehicles = [
            {"id": str(vehicle.id), "label": _vehicle_label(vehicle), "status": vehicle.status}
            for vehicle in Vehicle.objects.filter(status=VehicleStatus.DAMAGED).order_by("internal_number")[:5]
        ]

        distribution_order = [
            VehicleStatus.AVAILABLE,
            VehicleStatus.LOANED,
            VehicleStatus.MAINTENANCE,
            VehicleStatus.DAMAGED,
            VehicleStatus.MANUFACTURER_CHECKOUT,
            VehicleStatus.ANNOUNCED,
            VehicleStatus.CHECKED_IN,
            VehicleStatus.RESERVED,
            VehicleStatus.ARCHIVED,
        ]

        return Response(
            {
                "generated_at": now.isoformat(),
                "totals": {
                    "vehicles": total_vehicles,
                    "operational": operational,
                    "available": count_for(VehicleStatus.AVAILABLE),
                    "loaned": loaned,
                    "maintenance": count_for(VehicleStatus.MAINTENANCE),
                    "damaged": count_for(VehicleStatus.DAMAGED),
                    "manufacturer_checkout": count_for(VehicleStatus.MANUFACTURER_CHECKOUT),
                    "announced": count_for(VehicleStatus.ANNOUNCED),
                    "archived": count_for(VehicleStatus.ARCHIVED),
                    "active_loans": active_loans,
                    "overdue_loans": overdue_qs.count(),
                    "utilization_pct": utilization,
                },
                "status_distribution": [
                    {"status": status_value, "count": status_counts[status_value]}
                    for status_value in distribution_order
                    if status_counts.get(status_value)
                ],
                "checkouts_series": checkouts_series,
                "available_by_category": available_by_category,
                "recent_loans": recent_loans,
                "attention": {
                    "overdue_loans": overdue_loans_list,
                    "damaged_vehicles": damaged_vehicles,
                },
            }
        )

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
from workflows.models import Loan, LoanStatus, Reservation, ReservationStatus

CHECKOUT_SERIES_DAYS = 14


def _reservation_party(reservation: Reservation) -> str:
    if reservation.company_id and reservation.company:
        return reservation.company.name
    if reservation.driver_id and reservation.driver:
        return f"{reservation.driver.first_name} {reservation.driver.last_name}".strip()
    return reservation.reserved_for or ""


def _loan_party_differs(loan: Loan, reservation: Reservation) -> bool:
    """True when the vehicle's active loan is held by someone other than the reserver."""
    if reservation.company_id or reservation.driver_id:
        return loan.company_id != reservation.company_id or loan.driver_id != reservation.driver_id
    if reservation.reserved_for:
        return (loan.borrower_name or "").strip().lower() != reservation.reserved_for.strip().lower()
    # Reservation has no party info but the vehicle is already loaned out.
    return True


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

        # Vehicles handed back to the manufacturer or archived have left the
        # fleet. They live only in the Archive and must not count towards the
        # fleet total, the status chart, or per-category totals.
        removed = count_for(VehicleStatus.ARCHIVED) + count_for(VehicleStatus.MANUFACTURER_CHECKOUT)
        fleet_total = sum(status_counts.values()) - removed
        operational = fleet_total
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
                total=Count(
                    "vehicles",
                    filter=~Q(
                        vehicles__status__in=[VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT]
                    ),
                ),
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

        # Reservations: upcoming bookings + conflicts (reserved vehicle currently
        # loaned to a different party while the reservation window is active).
        upcoming_reservations = list(
            Reservation.objects.select_related("vehicle", "company", "driver")
            .filter(status=ReservationStatus.ACTIVE, end_at__gte=now)
            .order_by("start_at")[:6]
        )
        due_reservations = list(
            Reservation.objects.select_related("company", "driver")
            .filter(status=ReservationStatus.ACTIVE, start_at__lte=now, end_at__gte=now)
        )
        upcoming_count = Reservation.objects.filter(status=ReservationStatus.ACTIVE, end_at__gte=now).count()

        reservation_vehicle_ids = {res.vehicle_id for res in upcoming_reservations} | {
            res.vehicle_id for res in due_reservations
        }
        active_loans_by_vehicle = {
            loan.vehicle_id: loan
            for loan in Loan.objects.select_related("driver", "company").filter(
                vehicle_id__in=reservation_vehicle_ids, status=LoanStatus.ACTIVE
            )
        }

        def reservation_conflict(reservation: Reservation) -> bool:
            loan = active_loans_by_vehicle.get(reservation.vehicle_id)
            return bool(reservation.start_at <= now and loan and _loan_party_differs(loan, reservation))

        conflict_count = sum(1 for reservation in due_reservations if reservation_conflict(reservation))

        reservations_payload = [
            {
                "id": str(reservation.id),
                "vehicle": str(reservation.vehicle_id),
                "vehicle_label": _vehicle_label(reservation.vehicle),
                "reserved_for": _reservation_party(reservation),
                "company": str(reservation.company_id) if reservation.company_id else None,
                "driver": str(reservation.driver_id) if reservation.driver_id else None,
                "start_at": reservation.start_at.isoformat(),
                "end_at": reservation.end_at.isoformat(),
                "conflict": reservation_conflict(reservation),
            }
            for reservation in upcoming_reservations
        ]

        # The status chart reflects the active fleet only; removed vehicles
        # (manufacturer checkout / archived) are intentionally excluded.
        distribution_order = [
            VehicleStatus.AVAILABLE,
            VehicleStatus.LOANED,
            VehicleStatus.MAINTENANCE,
            VehicleStatus.DAMAGED,
            VehicleStatus.ANNOUNCED,
            VehicleStatus.CHECKED_IN,
            VehicleStatus.RESERVED,
        ]

        return Response(
            {
                "generated_at": now.isoformat(),
                "totals": {
                    "vehicles": fleet_total,
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
                    "upcoming_reservations": upcoming_count,
                    "reservation_conflicts": conflict_count,
                },
                "status_distribution": [
                    {"status": status_value, "count": status_counts[status_value]}
                    for status_value in distribution_order
                    if status_counts.get(status_value)
                ],
                "checkouts_series": checkouts_series,
                "available_by_category": available_by_category,
                "reservations": reservations_payload,
                "recent_loans": recent_loans,
                "attention": {
                    "overdue_loans": overdue_loans_list,
                    "damaged_vehicles": damaged_vehicles,
                },
            }
        )

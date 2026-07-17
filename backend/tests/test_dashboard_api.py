from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import Loan, LoanStatus, Reservation, ReservationStatus

SUMMARY_URL = "/api/v1/dashboard/summary/"


class DashboardSummaryTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="ops", password="secret", role="operations")
        self.category = VehicleCategory.objects.create(name="Steiger")

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def make_vehicle(self, *, status_value, number):
        values = {
            "internal_number": number,
            "category": self.category,
            "manufacturer": "Acme",
            "model": "TH100",
            "status": status_value,
        }
        if status_value == VehicleStatus.ARCHIVED:
            values.update(
                archived_by=self.user,
                archive_reason="Legacy record removed from the active fleet",
            )
        return Vehicle.objects.create(**values)

    def test_requires_authentication(self):
        response = APIClient().get(SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manufacturer_checkout_and_archived_excluded_from_fleet(self):
        self.make_vehicle(status_value=VehicleStatus.AVAILABLE, number="FZ-1")
        self.make_vehicle(status_value=VehicleStatus.MANUFACTURER_CHECKOUT, number="FZ-2")
        self.make_vehicle(status_value=VehicleStatus.ARCHIVED, number="FZ-3")

        response = self.client_for(self.user).get(SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        totals = response.data["totals"]

        # Only the available vehicle is part of the fleet total / operational count.
        self.assertEqual(totals["vehicles"], 1)
        self.assertEqual(totals["operational"], 1)

        # The status chart and category totals must not include removed vehicles.
        chart_statuses = {row["status"] for row in response.data["status_distribution"]}
        self.assertNotIn(VehicleStatus.MANUFACTURER_CHECKOUT, chart_statuses)
        self.assertNotIn(VehicleStatus.ARCHIVED, chart_statuses)
        categories = {row["name"]: row for row in response.data["available_by_category"]}
        self.assertEqual(categories["Steiger"]["total"], 1)

    def test_summary_on_empty_database_returns_zeroed_metrics(self):
        response = self.client_for(self.user).get(SUMMARY_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        totals = response.data["totals"]
        self.assertEqual(totals["vehicles"], 0)
        self.assertEqual(totals["utilization_pct"], 0)
        self.assertEqual(response.data["status_distribution"], [])
        self.assertEqual(response.data["recent_loans"], [])
        self.assertEqual(response.data["attention"]["overdue_loans"], [])
        self.assertEqual(len(response.data["checkouts_series"]), 14)

    def test_summary_aggregates_status_loans_and_overdue(self):
        available = self.make_vehicle(status_value=VehicleStatus.AVAILABLE, number="FZ-1")
        loaned = self.make_vehicle(status_value=VehicleStatus.LOANED, number="FZ-2")
        self.make_vehicle(status_value=VehicleStatus.DAMAGED, number="FZ-3")

        Loan.objects.create(
            vehicle=loaned,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() - timedelta(days=1),  # overdue
            status=LoanStatus.ACTIVE,
            created_by=self.user,
        )

        response = self.client_for(self.user).get(SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        totals = response.data["totals"]
        self.assertEqual(totals["vehicles"], 3)
        self.assertEqual(totals["available"], 1)
        self.assertEqual(totals["loaned"], 1)
        self.assertEqual(totals["damaged"], 1)
        self.assertEqual(totals["active_loans"], 1)
        self.assertEqual(totals["overdue_loans"], 1)
        # operational = 3 (none archived / manufacturer); 1 of 3 loaned -> 33%
        self.assertEqual(totals["operational"], 3)
        self.assertEqual(totals["utilization_pct"], 33)
        self.assertEqual(len(response.data["attention"]["overdue_loans"]), 1)
        self.assertEqual(len(response.data["attention"]["damaged_vehicles"]), 1)

        categories = {row["name"]: row for row in response.data["available_by_category"]}
        self.assertEqual(categories["Steiger"]["total"], 3)
        self.assertEqual(categories["Steiger"]["available"], 1)

        # availability is unused here but ensures the recent-loans shape is present
        self.assertEqual(response.data["recent_loans"][0]["vehicle_label"], "FZ-2 · Acme · TH100")
        self.assertEqual(available.status, VehicleStatus.AVAILABLE)

    def test_summary_flags_reservation_conflict_when_loaned_to_another_party(self):
        now = timezone.now()
        vehicle = self.make_vehicle(status_value=VehicleStatus.LOANED, number="FZ-RES")
        Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Someone Else",
            expected_return_at=now + timedelta(days=1),
            status=LoanStatus.ACTIVE,
            created_by=self.user,
        )
        Reservation.objects.create(
            vehicle=vehicle,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(days=2),
            reserved_for="Crew A",
            status=ReservationStatus.ACTIVE,
            created_by=self.user,
        )

        response = self.client_for(self.user).get(SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["totals"]["upcoming_reservations"], 1)
        self.assertEqual(response.data["totals"]["reservation_conflicts"], 1)
        self.assertEqual(len(response.data["reservations"]), 1)
        self.assertTrue(response.data["reservations"][0]["conflict"])
        self.assertEqual(response.data["reservations"][0]["reserved_for"], "Crew A")

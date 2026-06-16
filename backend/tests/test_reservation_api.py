from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from drivers.models import Driver
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import Reservation, ReservationStatus

RESERVATIONS_URL = "/api/v1/reservations/"


class ReservationAPITests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.operations_user = user_model.objects.create_user(username="ops", password="secret", role="operations")
        self.readonly_user = user_model.objects.create_user(username="reader", password="secret", role="readonly")
        self.category = VehicleCategory.objects.create(name="Steiger")
        self.vehicle = Vehicle.objects.create(
            internal_number="FZ-1",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.AVAILABLE,
        )
        self.driver = Driver.objects.create(first_name="Lukas", last_name="Meyer")

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def payload(self, *, start_offset_days=1, duration_days=2):
        start = timezone.now() + timedelta(days=start_offset_days)
        return {
            "vehicle": str(self.vehicle.id),
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(days=duration_days)).isoformat(),
            "driver": str(self.driver.id),
        }

    def test_reservation_requires_a_driver(self):
        data = self.payload()
        del data["driver"]
        response = self.client_for(self.operations_user).post(RESERVATIONS_URL, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", response.data)

    def test_operations_can_create_reservation(self):
        response = self.client_for(self.operations_user).post(RESERVATIONS_URL, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], ReservationStatus.ACTIVE)
        self.assertEqual(Reservation.objects.count(), 1)

    def test_readonly_cannot_create_reservation(self):
        response = self.client_for(self.readonly_user).post(RESERVATIONS_URL, self.payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_end_before_start_is_rejected(self):
        data = self.payload()
        data["end_at"] = data["start_at"]
        response = self.client_for(self.operations_user).post(RESERVATIONS_URL, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_overlapping_active_reservation_is_rejected_but_allowed_after_cancel(self):
        client = self.client_for(self.operations_user)
        first = client.post(RESERVATIONS_URL, self.payload(start_offset_days=2, duration_days=3), format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        overlap = client.post(RESERVATIONS_URL, self.payload(start_offset_days=3, duration_days=1), format="json")
        self.assertEqual(overlap.status_code, status.HTTP_400_BAD_REQUEST)

        cancel = client.post(f"{RESERVATIONS_URL}{first.data['id']}/cancel/")
        self.assertEqual(cancel.status_code, status.HTTP_200_OK)
        self.assertEqual(cancel.data["status"], ReservationStatus.CANCELLED)

        retry = client.post(RESERVATIONS_URL, self.payload(start_offset_days=3, duration_days=1), format="json")
        self.assertEqual(retry.status_code, status.HTTP_201_CREATED)

    def test_list_filters_by_vehicle_and_appears_in_history(self):
        client = self.client_for(self.operations_user)
        client.post(RESERVATIONS_URL, self.payload(), format="json")

        listed = client.get(f"{RESERVATIONS_URL}?vehicle={self.vehicle.id}")
        results = listed.data["results"] if isinstance(listed.data, dict) else listed.data
        self.assertEqual(len(results), 1)

        history = client.get(f"/api/v1/vehicles/{self.vehicle.id}/history/")
        self.assertEqual(len(history.data["reservations"]), 1)

    def test_schedule_and_clear_manufacturer_return_due(self):
        client = self.client_for(self.operations_user)
        due = (timezone.now() + timedelta(days=30)).date().isoformat()

        scheduled = client.post(
            f"/api/v1/vehicles/{self.vehicle.id}/schedule-manufacturer-return/",
            {"manufacturer_return_due": due},
            format="json",
        )
        self.assertEqual(scheduled.status_code, status.HTTP_200_OK, scheduled.data)
        self.assertEqual(scheduled.data["manufacturer_return_due"], due)

        cleared = client.post(
            f"/api/v1/vehicles/{self.vehicle.id}/schedule-manufacturer-return/",
            {"manufacturer_return_due": ""},
            format="json",
        )
        self.assertEqual(cleared.status_code, status.HTTP_200_OK)
        self.assertIsNone(cleared.data["manufacturer_return_due"])

    def test_readonly_cannot_schedule_manufacturer_return(self):
        response = self.client_for(self.readonly_user).post(
            f"/api/v1/vehicles/{self.vehicle.id}/schedule-manufacturer-return/",
            {"manufacturer_return_due": "2026-12-01"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

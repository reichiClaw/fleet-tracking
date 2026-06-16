from __future__ import annotations

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from audit.models import AuditLog
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import CheckInProtocol


class ResetImportedVehiclesCommandTests(TestCase):
    def setUp(self):
        self.category = VehicleCategory.objects.create(name="Steiger")
        self.user = get_user_model().objects.create_user(username="ops", password="secret", role="operations")

    def _vehicle(self, number, status=VehicleStatus.AVAILABLE):
        return Vehicle.objects.create(
            internal_number=number,
            category=self.category,
            manufacturer="Acme",
            model="TH",
            status=status,
        )

    def _mark_imported(self, vehicle):
        AuditLog.objects.create(
            action="import.vehicle.created", entity_type="vehicle", entity_id=vehicle.id
        )

    def test_resets_only_imported_uncheckedin_available_vehicles(self):
        imported = self._vehicle("FZ-00001")
        self._mark_imported(imported)

        manual = self._vehicle("FZ-00002")  # available but not imported

        imported_checked = self._vehicle("FZ-00003")
        self._mark_imported(imported_checked)
        CheckInProtocol.objects.create(vehicle=imported_checked, performed_by=self.user)

        call_command("reset_imported_vehicles_to_announced", stdout=StringIO())

        imported.refresh_from_db()
        manual.refresh_from_db()
        imported_checked.refresh_from_db()

        self.assertEqual(imported.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(manual.status, VehicleStatus.AVAILABLE)
        self.assertEqual(imported_checked.status, VehicleStatus.AVAILABLE)

    def test_dry_run_changes_nothing(self):
        imported = self._vehicle("FZ-00001")
        self._mark_imported(imported)

        call_command("reset_imported_vehicles_to_announced", "--dry-run", stdout=StringIO())

        imported.refresh_from_db()
        self.assertEqual(imported.status, VehicleStatus.AVAILABLE)

    def test_all_flag_also_resets_non_imported_available_vehicles(self):
        manual = self._vehicle("FZ-00002")  # available, no import log, no check-in

        call_command("reset_imported_vehicles_to_announced", "--all", stdout=StringIO())

        manual.refresh_from_db()
        self.assertEqual(manual.status, VehicleStatus.ANNOUNCED)

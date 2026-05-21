from __future__ import annotations

from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import Workbook
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from imports.models import ImportJob
from mediafiles.models import MediaFile, MediaType
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus


HEADER = [
    "internal_number",
    "category",
    "manufacturer",
    "model",
    "serial_number",
    "license_plate",
    "current_odometer_km",
    "current_operating_hours",
    "current_location",
    "supplier",
    "notes",
]


class VehicleImportAPITests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="admin", password="secret", role="admin", is_staff=True
        )
        self.operations_user = user_model.objects.create_user(username="ops", password="secret", role="operations")
        self.category = VehicleCategory.objects.create(name="Steiger")

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def workbook_upload(self, rows, filename="vehicles.xlsx"):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.append(HEADER)
        for row in rows:
            worksheet.append(row)
        buffer = BytesIO()
        workbook.save(buffer)
        workbook.close()
        buffer.seek(0)
        return SimpleUploadedFile(
            filename,
            buffer.read(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def test_vehicle_import_upload_is_admin_only(self):
        response = self.client_for(self.operations_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload([["VH-001", "Steiger", "Acme", "TH100"]])},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ImportJob.objects.count(), 0)
        self.assertEqual(Vehicle.objects.count(), 0)

    def test_valid_vehicle_import_validates_then_commits_create_and_update(self):
        existing = Vehicle.objects.create(
            internal_number="VH-001",
            category=self.category,
            manufacturer="Old",
            model="Old Model",
            status=VehicleStatus.ANNOUNCED,
            current_odometer_km=10,
        )
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [
                        [
                            "VH-001",
                            "Steiger",
                            "Acme",
                            "TH110",
                            "SN-001",
                            "LP-001",
                            15,
                            2.5,
                            "Yard",
                            "Supplier",
                            "Updated",
                        ],
                        ["VH-002", "Steiger", "Beta", "Lift", "SN-002", "LP-002", 0, 0, "Depot", "", "New"],
                    ]
                )
            },
            format="multipart",
        )

        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(upload_response.data["status"], ImportJob.Status.VALIDATED)
        self.assertEqual(upload_response.data["error_count"], 0)
        self.assertEqual(Vehicle.objects.count(), 1)
        self.assertEqual(MediaFile.objects.get().media_type, MediaType.IMPORT)

        commit_response = self.client_for(self.admin_user).post(
            f"/api/v1/imports/{upload_response.data['id']}/commit/",
            format="json",
        )

        self.assertEqual(commit_response.status_code, status.HTTP_200_OK)
        self.assertEqual(commit_response.data["status"], ImportJob.Status.COMMITTED)
        existing.refresh_from_db()
        created = Vehicle.objects.get(internal_number="VH-002")
        self.assertEqual(existing.manufacturer, "Acme")
        self.assertEqual(existing.model, "TH110")
        self.assertEqual(existing.current_odometer_km, 15)
        self.assertEqual(created.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(created.current_location, "Depot")
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.committed").exists())
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.created").exists())
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.updated").exists())

    def test_invalid_vehicle_import_returns_row_level_errors(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [["VH-001", "Missing Category", "Acme", "TH100", "", "", -1, "", "", "", ""]]
                )
            },
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], ImportJob.Status.FAILED)
        self.assertGreater(response.data["error_count"], 0)
        row = response.data["result"]["rows"][0]
        self.assertEqual(row["row_number"], 2)
        self.assertEqual({error["field"] for error in row["errors"]}, {"category", "current_odometer_km"})
        self.assertIn("Unknown or inactive vehicle category", row["errors"][0]["message"])
        self.assertEqual(Vehicle.objects.count(), 0)

    def test_invalid_vehicle_import_cannot_partially_commit_valid_rows(self):
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [
                        ["VH-001", "Steiger", "Acme", "TH100", "", "", 1, "", "", "", ""],
                        ["VH-002", "Missing Category", "Acme", "TH200", "", "", 2, "", "", "", ""],
                    ]
                )
            },
            format="multipart",
        )

        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(upload_response.data["status"], ImportJob.Status.FAILED)

        commit_response = self.client_for(self.admin_user).post(
            f"/api/v1/imports/{upload_response.data['id']}/commit/",
            format="json",
        )

        self.assertEqual(commit_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Vehicle.objects.count(), 0)


from __future__ import annotations

from io import BytesIO
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from openpyxl import Workbook
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from imports.models import ImportJob
from mediafiles.models import MediaFile, MediaType
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus


IMPORT_MEDIA_ROOT = tempfile.mkdtemp(prefix="fleet-import-tests-")


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


@override_settings(MEDIA_ROOT=IMPORT_MEDIA_ROOT)
class VehicleImportAPITests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(IMPORT_MEDIA_ROOT, ignore_errors=True)

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

    def workbook_upload(self, rows, filename="vehicles.xlsx", header=HEADER):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.append(header)
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

    def upload_and_commit(self, rows, header=HEADER):
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload(rows, header=header)},
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )
        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED, upload_response.data)
        self.assertEqual(
            upload_response.data["status"], ImportJob.Status.VALIDATED, upload_response.data["result"]
        )
        commit_response = self.client_for(self.admin_user).post(
            f"/api/v1/imports/{upload_response.data['id']}/commit/",
            format="json",
        )
        self.assertEqual(commit_response.status_code, status.HTTP_200_OK, commit_response.data)
        return commit_response

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
        self.assertEqual(created.status, VehicleStatus.AVAILABLE)
        self.assertEqual(existing.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(created.current_location, "Depot")
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.committed").exists())
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.created").exists())
        self.assertTrue(AuditLog.objects.filter(action="import.vehicle.updated").exists())

    def test_invalid_vehicle_import_returns_row_level_errors(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [["VH-001", "Steiger", "Acme", "TH100", "", "", -1, "", "", "", ""]]
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
        self.assertEqual({error["field"] for error in row["errors"]}, {"current_odometer_km"})
        self.assertEqual(Vehicle.objects.count(), 0)

    def test_invalid_vehicle_import_cannot_partially_commit_valid_rows(self):
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [
                        ["VH-001", "Steiger", "Acme", "TH100", "", "", 1, "", "", "", ""],
                        ["VH-002", "Steiger", "", "TH200", "", "", 2, "", "", "", ""],
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

    def test_import_generates_internal_number_when_column_missing(self):
        # Only the required columns are present; everything else is left out and
        # should be stored blank, with the fleet number generated automatically.
        header = ["category", "manufacturer", "model"]
        self.upload_and_commit([["Steiger", "Acme", "TH100"]], header=header)

        self.assertEqual(Vehicle.objects.count(), 1)
        vehicle = Vehicle.objects.get()
        self.assertTrue(vehicle.internal_number.startswith("FZ-"))
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)
        self.assertEqual(vehicle.serial_number, "")
        self.assertEqual(vehicle.license_plate, "")
        self.assertIsNone(vehicle.current_odometer_km)
        self.assertEqual(vehicle.current_location, "")

    def test_import_accepts_german_headers(self):
        header = ["Kategorie", "Hersteller", "Modell", "Kennzeichen", "Kilometerstand", "Standort"]
        self.upload_and_commit([["Steiger", "Acme", "TH100", "B-AC 123", 1500, "Depot Nord"]], header=header)

        self.assertEqual(Vehicle.objects.count(), 1)
        vehicle = Vehicle.objects.get()
        self.assertEqual(vehicle.manufacturer, "Acme")
        self.assertEqual(vehicle.model, "TH100")
        self.assertEqual(vehicle.license_plate, "B-AC 123")
        self.assertEqual(vehicle.current_odometer_km, 1500)
        self.assertEqual(vehicle.current_location, "Depot Nord")
        self.assertEqual(vehicle.category, self.category)

    def test_import_still_requires_core_columns(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload([["TH100"]], header=["model"])},
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], ImportJob.Status.FAILED)
        errors = response.data["result"]["errors"]
        self.assertTrue(any(error.get("field") == "manufacturer" for error in errors))
        self.assertEqual(Vehicle.objects.count(), 0)

    def test_upload_exposes_source_columns_for_interactive_mapping(self):
        header = ["Marke X", "Modell Y", "Standort Z"]
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload([["Acme", "TH100", "Depot Nord"]], header=header)},
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )

        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)
        # "Marke X"/"Modell Y" are not recognized automatically, so validation fails.
        self.assertEqual(upload_response.data["status"], ImportJob.Status.FAILED)
        result = upload_response.data["result"]
        labels = [column["label"] for column in result["source_columns"]]
        self.assertEqual(labels, ["Marke X", "Modell Y", "Standort Z"])
        self.assertEqual(result["source_columns"][0]["sample"], "Acme")

    def test_remap_lets_user_assign_columns_then_commit(self):
        header = ["Marke X", "Modell Y", "Standort Z"]
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload([["Acme", "TH100", "Depot Nord"]], header=header)},
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )
        job_id = upload_response.data["id"]
        self.assertEqual(upload_response.data["status"], ImportJob.Status.FAILED)

        remap_response = self.client_for(self.admin_user).post(
            f"/api/v1/imports/{job_id}/remap/",
            {"mapping": {"manufacturer": 0, "model": 1, "current_location": 2}},
            format="json",
        )
        self.assertEqual(remap_response.status_code, status.HTTP_200_OK, remap_response.data)
        self.assertEqual(remap_response.data["status"], ImportJob.Status.VALIDATED)

        commit_response = self.client_for(self.admin_user).post(
            f"/api/v1/imports/{job_id}/commit/",
            format="json",
        )
        self.assertEqual(commit_response.status_code, status.HTTP_200_OK, commit_response.data)
        self.assertEqual(Vehicle.objects.count(), 1)
        vehicle = Vehicle.objects.get()
        self.assertEqual(vehicle.manufacturer, "Acme")
        self.assertEqual(vehicle.model, "TH100")
        self.assertEqual(vehicle.current_location, "Depot Nord")

    def test_remap_is_admin_only(self):
        upload_response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {"file": self.workbook_upload([["VH-1", "Steiger", "Acme", "TH100", "", "", "", "", "", "", ""]])},
            format="multipart",
        )
        job_id = upload_response.data["id"]

        response = self.client_for(self.operations_user).post(
            f"/api/v1/imports/{job_id}/remap/",
            {"mapping": {"manufacturer": 2}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_overlong_value_is_reported_as_row_error_not_server_error(self):
        long_manufacturer = "A" * 200
        response = self.client_for(self.admin_user).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook_upload(
                    [["VH-1", "Steiger", long_manufacturer, "TH100", "", "", "", "", "", "", ""]]
                )
            },
            format="multipart",
            HTTP_ACCEPT_LANGUAGE="en",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], ImportJob.Status.FAILED)
        row = response.data["result"]["rows"][0]
        self.assertEqual({error["field"] for error in row["errors"]}, {"manufacturer"})
        self.assertIn("at most", row["errors"][0]["message"])
        self.assertEqual(Vehicle.objects.count(), 0)

    def test_unknown_category_falls_back_to_sonstiges(self):
        header = ["category", "manufacturer", "model"]
        self.upload_and_commit(
            [
                ["Unbekannt", "Acme", "TH100"],
                ["", "Acme", "TH200"],
            ],
            header=header,
        )

        fallback = VehicleCategory.objects.get(name="Sonstiges")
        self.assertTrue(fallback.is_active)
        self.assertEqual(Vehicle.objects.filter(category=fallback).count(), 2)
        # The catch-all category is reused, not duplicated, across rows.
        self.assertEqual(VehicleCategory.objects.filter(name="Sonstiges").count(), 1)


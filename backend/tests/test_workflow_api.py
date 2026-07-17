from __future__ import annotations

import shutil
import tempfile
from datetime import timedelta
from io import BytesIO

from PIL import Image as PillowImage
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from damages.models import DamageReport
from drivers.models import Driver
from mediafiles.models import MediaFile, MediaType
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol

def _image_bytes(image_format):
    buffer = BytesIO()
    PillowImage.new("RGB", (16, 16), color="blue").save(buffer, image_format)
    return buffer.getvalue()


PNG_BYTES = _image_bytes("PNG")
JPEG_BYTES = _image_bytes("JPEG")
WORKFLOW_MEDIA_ROOT = tempfile.mkdtemp(prefix="fleet-workflow-media-tests-")


def tearDownModule():
    shutil.rmtree(WORKFLOW_MEDIA_ROOT, ignore_errors=True)


@override_settings(MEDIA_ROOT=WORKFLOW_MEDIA_ROOT)
class WorkflowAPITestCase(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.operations_user = user_model.objects.create_user(
            username="ops", password="secret", role="operations"
        )
        self.category = VehicleCategory.objects.create(name="Steiger")
        self.company = Company.objects.create(name="SubCo", company_type="subcontractor")
        self.manufacturer = Company.objects.create(name="Maker", company_type="manufacturer")

    def api_client(self):
        client = APIClient()
        client.force_authenticate(user=self.operations_user)
        return client

    def upload_media(self, client, *, media_type, filename, content_type, content):
        """Upload a real media file and return its id (the supported attach path)."""
        response = client.post(
            "/api/v1/media/",
            {
                "file": SimpleUploadedFile(filename, content, content_type=content_type),
                "media_type": media_type,
            },
            format="multipart",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        return response.data["id"]

    def vehicle(self, *, status_value=VehicleStatus.AVAILABLE, odometer=100, hours="10.0"):
        return Vehicle.objects.create(
            internal_number=f"VH-{Vehicle.objects.count() + 1:03d}",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=status_value,
            current_odometer_km=odometer,
            current_operating_hours=hours,
        )


class CheckInWorkflowTests(WorkflowAPITestCase):
    def test_check_in_without_damage_reports_is_allowed(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED, odometer=10, hours="1.0")

        response = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "odometer_km": 20,
                "operating_hours": "2.5",
                "supplier_company": str(self.manufacturer.id),
                "condition_outcome": "fit",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)
        self.assertEqual(CheckInProtocol.objects.count(), 1)
        self.assertEqual(DamageReport.objects.count(), 0)

    def test_check_in_creates_protocol_damage_media_audit_and_updates_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED, odometer=10, hours="1.0")
        client = self.api_client()
        media_id = self.upload_media(
            client, media_type=MediaType.PHOTO, filename="scratch.jpg", content_type="image/jpeg", content=JPEG_BYTES
        )

        response = client.post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "odometer_km": 20,
                "operating_hours": "2.5",
                "condition_notes": "Visible scratch",
                "supplier_company": str(self.manufacturer.id),
                "condition_outcome": "new_damage",
                "damage_reports": [{"description": "Scratch on door", "severity": "minor"}],
                "media_file_ids": [media_id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)
        self.assertEqual(vehicle.current_odometer_km, 20)
        self.assertEqual(str(vehicle.current_operating_hours), "2.5")
        self.assertEqual(CheckInProtocol.objects.count(), 1)
        self.assertEqual(DamageReport.objects.count(), 1)
        # The uploaded photo plus the auto-generated check-in PDF.
        self.assertEqual(MediaFile.objects.filter(media_type=MediaType.PHOTO).count(), 1)
        attached = MediaFile.objects.get(media_type=MediaType.PHOTO)
        self.assertEqual(attached.vehicle, vehicle)
        self.assertEqual(attached.related_type, "check_in_protocol")
        pdf_doc = MediaFile.objects.get(media_type=MediaType.PDF)
        self.assertEqual(pdf_doc.related_type, "check_in_protocol_pdf")
        self.assertEqual(pdf_doc.vehicle, vehicle)
        self.assertEqual(CheckInProtocol.objects.get().pdf_media_id, pdf_doc.id)
        self.assertTrue(AuditLog.objects.filter(action="workflow.check_in.completed").exists())

    def test_check_in_rejects_condition_status_inconsistent_with_damage_reports(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED)
        client = self.api_client()

        available_with_damage = client.post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "target_status": VehicleStatus.AVAILABLE,
                "damage_reports": [{"description": "Visible dent", "severity": "minor"}],
            },
            format="json",
        )
        damaged_without_report = client.post(
            "/api/v1/workflows/check-ins/",
            {"vehicle": str(vehicle.id), "target_status": VehicleStatus.DAMAGED},
            format="json",
        )

        self.assertEqual(available_with_damage.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(damaged_without_report.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(CheckInProtocol.objects.count(), 0)
        self.assertEqual(DamageReport.objects.count(), 0)

    def test_check_in_rejects_future_workflow_timestamp(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED)

        response = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "performed_at": (timezone.now() + timedelta(minutes=5)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(CheckInProtocol.objects.count(), 0)

    def test_check_in_rejects_decreasing_odometer_atomically(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED, odometer=100)

        response = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {"vehicle": str(vehicle.id), "odometer_km": 99},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.ANNOUNCED)
        self.assertEqual(CheckInProtocol.objects.count(), 0)

    def test_check_in_idempotency_key_replays_without_duplicate_protocol(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED)
        client = self.api_client()
        payload = {
            "vehicle": str(vehicle.id),
            "supplier_company": str(self.manufacturer.id),
            "condition_outcome": "fit",
            "odometer_km": 100,
            "operating_hours": "10.0",
        }

        first = client.post(
            "/api/v1/workflows/check-ins/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkin-123",
        )
        replay = client.post(
            "/api/v1/workflows/check-ins/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkin-123",
        )
        conflict = client.post(
            "/api/v1/workflows/check-ins/",
            {**payload, "condition_notes": "Different request"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkin-123",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(conflict.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(first.data["id"], replay.data["id"])
        self.assertEqual(CheckInProtocol.objects.count(), 1)


class LoanWorkflowTests(WorkflowAPITestCase):
    def test_database_allows_only_one_active_loan_per_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)
        Loan.objects.create(
            vehicle=vehicle,
            borrower_name="First",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            # ``Loan.save()`` validates constraints before reaching the
            # database. Bulk creation intentionally bypasses model validation
            # so this test verifies the partial unique index itself.
            Loan.objects.bulk_create(
                [
                    Loan(
                        vehicle=vehicle,
                        borrower_name="Second",
                        borrower_phone="456",
                        expected_return_at=timezone.now() + timedelta(days=2),
                        created_by=self.operations_user,
                    )
                ]
            )

    def test_damage_cannot_reference_a_loan_for_another_vehicle(self):
        first = self.vehicle(status_value=VehicleStatus.LOANED)
        second = self.vehicle(status_value=VehicleStatus.AVAILABLE)
        loan = Loan.objects.create(
            vehicle=first,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )
        with self.assertRaises(DjangoValidationError):
            DamageReport.objects.create(
                vehicle=second,
                loan=loan,
                workflow_phase="loan_checkout",
                description="Wrong vehicle",
                created_by=self.operations_user,
            )

    def test_loan_checkout_creates_active_loan_and_marks_vehicle_loaned(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE, odometer=100, hours="10.0")
        client = self.api_client()
        media_id = self.upload_media(
            client, media_type=MediaType.SIGNATURE, filename="signature.png", content_type="image/png", content=PNG_BYTES
        )

        response = client.post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "company": str(self.company.id),
                "borrower_name": "Borrower",
                "borrower_phone": "123",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "checkout_odometer_km": 120,
                "checkout_operating_hours": "11.5",
                "media_file_ids": [media_id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        vehicle.refresh_from_db()
        loan = Loan.objects.get()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)
        self.assertEqual(vehicle.current_odometer_km, 120)
        self.assertTrue(AuditLog.objects.filter(action="workflow.loan_checkout.completed").exists())
        self.assertEqual(MediaFile.objects.get(media_type=MediaType.SIGNATURE).loan, loan)
        # A loan-checkout PDF report is generated and linked automatically.
        pdf_doc = MediaFile.objects.get(media_type=MediaType.PDF)
        self.assertEqual(pdf_doc.related_type, "loan_checkout_pdf")
        self.assertEqual(pdf_doc.loan, loan)
        loan.refresh_from_db()
        self.assertEqual(loan.checkout_pdf_media_id, pdf_doc.id)
        self.assertIn(loan.checkout_pdf_language, {"de", "en"})

    def test_loan_checkout_rejects_unavailable_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)

        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Borrower",
                "borrower_phone": "123",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Loan.objects.count(), 0)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)

    def test_loan_checkout_requires_borrower_phone_and_signature(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)

        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Walk-in borrower",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Loan.objects.count(), 0)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)

    def test_loan_checkout_rejects_photo_instead_of_signature(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)
        client = self.api_client()
        photo_id = self.upload_media(
            client,
            media_type=MediaType.PHOTO,
            filename="photo.png",
            content_type="image/png",
            content=PNG_BYTES,
        )
        response = client.post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Borrower",
                "borrower_phone": "123",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "media_file_ids": [photo_id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Loan.objects.count(), 0)

    def test_loan_checkout_rejects_inactive_driver(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)
        driver = Driver.objects.create(
            first_name="Inactive",
            last_name="Driver",
            phone="123",
            company=self.company,
            is_active=False,
        )
        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "company": str(self.company.id),
                "driver": str(driver.id),
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Loan.objects.count(), 0)

    def test_loan_return_closes_active_loan_and_marks_damaged_when_damage_reported(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED, odometer=120, hours="11.5")
        loan = Loan.objects.create(
            vehicle=vehicle,
            company=self.company,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            checkout_odometer_km=120,
            checkout_operating_hours="11.5",
            created_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {
                "return_odometer_km": 130,
                "return_operating_hours": "12.0",
                "return_notes": "Returned with scratch",
                "damage_reports": [{"description": "New scratch", "severity": "minor"}],
                "condition_outcome": "new_damage",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        vehicle.refresh_from_db()
        loan.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.RETURNED)
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)
        self.assertEqual(vehicle.current_odometer_km, 130)
        self.assertTrue(AuditLog.objects.filter(action="workflow.loan_return.completed").exists())

    def test_loan_return_rejects_available_status_when_damage_is_reported(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {
                "target_status": VehicleStatus.AVAILABLE,
                "damage_reports": [{"description": "New dent", "severity": "minor"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        loan.refresh_from_db()
        vehicle.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)
        self.assertEqual(DamageReport.objects.count(), 0)

    def test_loan_return_preserves_damaged_status_for_existing_unresolved_damage(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )
        DamageReport.objects.create(
            vehicle=vehicle,
            loan=loan,
            workflow_phase="loan_checkout",
            description="Damage recorded at checkout",
            created_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {
                "condition_outcome": "fit",
                "return_odometer_km": 100,
                "return_operating_hours": "10.0",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        loan.refresh_from_db()
        vehicle.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.RETURNED)
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)

    def test_loan_return_rejects_non_active_loan(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE, odometer=120)
        loan = Loan.objects.create(
            vehicle=vehicle,
            company=self.company,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            actual_return_at=timezone.now(),
            status=LoanStatus.RETURNED,
            checkout_odometer_km=100,
            return_odometer_km=120,
            created_by=self.operations_user,
            returned_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {"return_odometer_km": 121},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.current_odometer_km, 120)

    def test_loan_return_rejects_decreasing_readings_atomically(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED, odometer=120)
        loan = Loan.objects.create(
            vehicle=vehicle,
            company=self.company,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            checkout_odometer_km=120,
            created_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {"return_odometer_km": 119},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        loan.refresh_from_db()
        vehicle.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)

    def test_loan_return_rejects_timestamp_before_checkout(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )
        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {"actual_return_at": (loan.created_at - timedelta(seconds=1)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        loan.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)

    def test_loan_return_rejects_future_timestamp(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )

        response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {"actual_return_at": (timezone.now() + timedelta(minutes=5)).isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        loan.refresh_from_db()
        vehicle.refresh_from_db()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)


class GeneratedReportsTests(WorkflowAPITestCase):
    def _results(self, response):
        return response.data["results"] if isinstance(response.data, dict) else response.data

    def test_workflow_report_is_listed_and_searchable(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)
        client = self.api_client()
        checkout = client.post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Searchable Borrower",
                "borrower_phone": "123",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "checkout_odometer_km": 100,
                "checkout_operating_hours": "10.0",
                "media_file_ids": [
                    self.upload_media(
                        client,
                        media_type=MediaType.SIGNATURE,
                        filename="search-signature.png",
                        content_type="image/png",
                        content=PNG_BYTES,
                    )
                ],
            },
            format="json",
        )
        self.assertEqual(checkout.status_code, status.HTTP_201_CREATED, checkout.data)

        listed = self._results(client.get("/api/v1/documents/"))
        self.assertTrue(any(doc["related_type"] == "loan_checkout_pdf" for doc in listed))
        self.assertTrue(all(doc.get("download_url") for doc in listed))
        self.assertTrue(all("vehicle_label" in doc for doc in listed))

        by_search = self._results(client.get("/api/v1/documents/?search=Acme"))
        self.assertGreaterEqual(len(by_search), 1)
        self.assertTrue(all("Acme" in doc["vehicle_label"] for doc in by_search))

        by_type = self._results(client.get("/api/v1/documents/?type=loan_return_pdf"))
        self.assertEqual(by_type, [])


class ManufacturerCheckoutWorkflowTests(WorkflowAPITestCase):
    def test_manufacturer_checkout_creates_protocol_and_updates_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE, odometer=200)

        response = self.api_client().post(
            "/api/v1/workflows/manufacturer-checkouts/",
            {
                "vehicle": str(vehicle.id),
                "recipient_company": str(self.manufacturer.id),
                "odometer_km": 205,
                "operating_hours": "10.0",
                "condition_notes": "Returned to supplier",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.MANUFACTURER_CHECKOUT)
        self.assertEqual(vehicle.current_odometer_km, 205)
        self.assertEqual(ManufacturerCheckOutProtocol.objects.count(), 1)
        self.assertTrue(AuditLog.objects.filter(action="workflow.manufacturer_checkout.completed").exists())

    def test_manufacturer_checkout_rejects_future_workflow_timestamp(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE)

        response = self.api_client().post(
            "/api/v1/workflows/manufacturer-checkouts/",
            {
                "vehicle": str(vehicle.id),
                "performed_at": (timezone.now() + timedelta(minutes=5)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)
        self.assertEqual(ManufacturerCheckOutProtocol.objects.count(), 0)

    def test_manufacturer_checkout_rejects_loaned_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.LOANED)

        response = self.api_client().post(
            "/api/v1/workflows/manufacturer-checkouts/",
            {"vehicle": str(vehicle.id), "odometer_km": 101},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)
        self.assertEqual(ManufacturerCheckOutProtocol.objects.count(), 0)

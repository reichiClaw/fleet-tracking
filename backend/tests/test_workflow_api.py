from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from damages.models import DamageReport
from mediafiles.models import MediaFile, MediaType
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol


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
    def test_check_in_creates_protocol_damage_media_audit_and_updates_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.ANNOUNCED, odometer=10, hours="1.0")

        response = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "odometer_km": 20,
                "operating_hours": "2.5",
                "condition_notes": "Visible scratch",
                "damage_reports": [{"description": "Scratch on door", "severity": "minor"}],
                "media_files": [
                    {
                        "media_type": MediaType.PHOTO,
                        "original_filename": "scratch.jpg",
                        "content_type": "image/jpeg",
                        "size_bytes": 1234,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)
        self.assertEqual(vehicle.current_odometer_km, 20)
        self.assertEqual(str(vehicle.current_operating_hours), "2.5")
        self.assertEqual(CheckInProtocol.objects.count(), 1)
        self.assertEqual(DamageReport.objects.count(), 1)
        self.assertEqual(MediaFile.objects.count(), 1)
        self.assertTrue(AuditLog.objects.filter(action="workflow.check_in.completed").exists())

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


class LoanWorkflowTests(WorkflowAPITestCase):
    def test_loan_checkout_creates_active_loan_and_marks_vehicle_loaned(self):
        vehicle = self.vehicle(status_value=VehicleStatus.CHECKED_IN, odometer=100, hours="10.0")

        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "company": str(self.company.id),
                "borrower_name": "Borrower",
                "borrower_phone": "123",
                "expected_return_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "checkout_odometer_km": 120,
                "checkout_operating_hours": "11.5",
                "media_files": [
                    {
                        "media_type": MediaType.SIGNATURE,
                        "original_filename": "signature.png",
                        "content_type": "image/png",
                        "size_bytes": 500,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        vehicle.refresh_from_db()
        loan = Loan.objects.get()
        self.assertEqual(loan.status, LoanStatus.ACTIVE)
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)
        self.assertEqual(vehicle.current_odometer_km, 120)
        self.assertTrue(AuditLog.objects.filter(action="workflow.loan_checkout.completed").exists())
        self.assertEqual(MediaFile.objects.get().loan, loan)

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


class ManufacturerCheckoutWorkflowTests(WorkflowAPITestCase):
    def test_manufacturer_checkout_creates_protocol_and_updates_vehicle(self):
        vehicle = self.vehicle(status_value=VehicleStatus.AVAILABLE, odometer=200)

        response = self.api_client().post(
            "/api/v1/workflows/manufacturer-checkouts/",
            {
                "vehicle": str(vehicle.id),
                "recipient_company": str(self.manufacturer.id),
                "odometer_km": 205,
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

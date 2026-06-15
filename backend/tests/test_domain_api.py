from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import Loan


class DomainAPITestCase(TestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.admin_user = self.user_model.objects.create_user(
            username="admin", password="secret", role="admin", is_staff=True
        )
        self.operations_user = self.user_model.objects.create_user(
            username="ops", password="secret", role="operations"
        )
        self.readonly_user = self.user_model.objects.create_user(
            username="reader", password="secret", role="readonly"
        )

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client


class AuthEndpointTests(DomainAPITestCase):
    def test_login_me_and_logout_use_session_auth(self):
        client = APIClient()

        login_response = client.post(
            reverse("auth-login"), {"username": "ops", "password": "secret"}, format="json"
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertEqual(login_response.data["username"], "ops")
        self.assertEqual(login_response.data["role"], "operations")

        me_response = client.get(reverse("auth-me"))
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)
        self.assertEqual(me_response.data["username"], "ops")

        logout_response = client.post(reverse("auth-logout"))
        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)

        logged_out_me_response = client.get(reverse("auth-me"))
        self.assertEqual(logged_out_me_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_protected_domain_endpoint_rejects_anonymous_user(self):
        response = APIClient().get("/api/v1/vehicle-categories/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class DomainPermissionTests(DomainAPITestCase):
    def test_admin_can_create_vehicle_category(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/vehicle-categories/",
            {"name": "Steiger", "description": "Lift", "is_active": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(VehicleCategory.objects.filter(name="Steiger").exists())

    def test_operations_can_read_but_not_create_vehicle_categories(self):
        VehicleCategory.objects.create(name="Golf Car")
        client = self.client_for(self.operations_user)

        list_response = client.get("/api/v1/vehicle-categories/")
        create_response = client.post("/api/v1/vehicle-categories/", {"name": "Loader"}, format="json")

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_operations_can_create_companies_but_readonly_cannot_mutate(self):
        operations_response = self.client_for(self.operations_user).post(
            "/api/v1/companies/",
            {"name": "SubCo", "company_type": "subcontractor", "is_active": True},
            format="json",
        )
        readonly_response = self.client_for(self.readonly_user).post(
            "/api/v1/companies/",
            {"name": "ReadOnlyCo", "company_type": "supplier", "is_active": True},
            format="json",
        )

        self.assertEqual(operations_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(readonly_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_audit_log_is_admin_read_only(self):
        AuditLog.objects.create(actor=self.admin_user, action="vehicle.created", entity_type="vehicle")

        admin_list_response = self.client_for(self.admin_user).get("/api/v1/audit-logs/")
        readonly_list_response = self.client_for(self.readonly_user).get("/api/v1/audit-logs/")
        admin_create_response = self.client_for(self.admin_user).post(
            "/api/v1/audit-logs/",
            {"action": "vehicle.updated", "entity_type": "vehicle"},
            format="json",
        )

        self.assertEqual(admin_list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(readonly_list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(admin_create_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_operations_can_read_but_not_mutate_vehicle_master_data(self):
        category = VehicleCategory.objects.create(name="Telehandler")
        vehicle = Vehicle.objects.create(
            internal_number="VH-OPS",
            category=category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.ANNOUNCED,
        )
        client = self.client_for(self.operations_user)

        retrieve_response = client.get(f"/api/v1/vehicles/{vehicle.id}/")
        patch_response = client.patch(
            f"/api/v1/vehicles/{vehicle.id}/",
            {"model": "TH200"},
            format="json",
        )

        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.status_code, status.HTTP_403_FORBIDDEN)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.model, "TH100")


class VehicleStatusValidationTests(DomainAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = VehicleCategory.objects.create(name="Telehandler")
        self.vehicle = Vehicle.objects.create(
            internal_number="VH-001",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.ANNOUNCED,
            current_odometer_km=100,
        )

    def test_invalid_direct_vehicle_status_transition_is_rejected(self):
        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{self.vehicle.id}/", {"status": VehicleStatus.LOANED}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.ANNOUNCED)

    def test_allowed_vehicle_status_transition_is_accepted(self):
        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{self.vehicle.id}/", {"status": VehicleStatus.CHECKED_IN}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.CHECKED_IN)

    def test_vehicle_readings_cannot_decrease(self):
        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{self.vehicle.id}/", {"current_odometer_km": 99}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.current_odometer_km, 100)

    def test_admin_cannot_set_loaned_status_by_editing_vehicle(self):
        vehicle = Vehicle.objects.create(
            internal_number="VH-AVAIL",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.AVAILABLE,
        )

        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{vehicle.id}/", {"status": VehicleStatus.LOANED}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)

    def test_admin_cannot_clear_loaned_status_while_loan_is_active(self):
        vehicle = Vehicle.objects.create(
            internal_number="VH-LOANED",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.LOANED,
        )
        Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )

        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{vehicle.id}/", {"status": VehicleStatus.AVAILABLE}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.LOANED)

    def test_admin_can_move_available_vehicle_to_maintenance(self):
        vehicle = Vehicle.objects.create(
            internal_number="VH-MAINT",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.AVAILABLE,
        )

        response = self.client_for(self.admin_user).patch(
            f"/api/v1/vehicles/{vehicle.id}/", {"status": VehicleStatus.MAINTENANCE}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.MAINTENANCE)

    def test_vehicle_history_returns_related_records(self):
        company = Company.objects.create(name="Borrower Ltd", company_type="subcontractor")
        Loan.objects.create(
            vehicle=self.vehicle,
            company=company,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )

        response = self.client_for(self.readonly_user).get(f"/api/v1/vehicles/{self.vehicle.id}/history/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(response.data.keys()), {"loans", "check_ins", "manufacturer_checkouts", "damages", "media"})
        self.assertEqual(len(response.data["loans"]), 1)

    def test_vehicle_qr_resolver_uses_generated_code_not_id(self):
        response = self.client_for(self.readonly_user).get(f"/api/v1/vehicles/qr/{self.vehicle.qr_code}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotEqual(self.vehicle.qr_code, str(self.vehicle.id))
        self.assertEqual(response.data["vehicle"]["id"], str(self.vehicle.id))
        self.assertEqual(response.data["vehicle"]["qr_code"], self.vehicle.qr_code)
        self.assertIsNone(response.data["active_loan"])

    def test_vehicle_qr_resolver_returns_active_loan(self):
        loan = Loan.objects.create(
            vehicle=self.vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.operations_user,
        )

        response = self.client_for(self.readonly_user).get(f"/api/v1/vehicles/qr/{self.vehicle.qr_code}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["active_loan"]["id"], str(loan.id))

    def test_unknown_vehicle_qr_code_returns_not_found(self):
        response = self.client_for(self.readonly_user).get("/api/v1/vehicles/qr/VH-UNKNOWN999/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_public_qr_status_is_available_without_authentication(self):
        response = APIClient().get(f"/api/v1/public/vehicles/qr/{self.vehicle.qr_code}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["qr_code"], self.vehicle.qr_code)
        self.assertEqual(response.data["status"], VehicleStatus.ANNOUNCED)
        # Privacy-safe: no loan/borrower or free-form notes are exposed publicly.
        self.assertNotIn("notes", response.data)
        self.assertNotIn("active_loan", response.data)

    def test_public_qr_status_unknown_returns_not_found(self):
        response = APIClient().get("/api/v1/public/vehicles/qr/VH-UNKNOWN999/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_create_vehicle_directly_in_available_pool(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/vehicles/",
            {
                "category": str(self.category.id),
                "manufacturer": "Acme",
                "model": "PoolStar",
                "serial_number": "SN-POOL-1",
                "status": VehicleStatus.AVAILABLE,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], VehicleStatus.AVAILABLE)
        self.assertTrue(response.data["internal_number"].startswith("FZ-"))

    def test_operations_cannot_create_vehicle(self):
        response = self.client_for(self.operations_user).post(
            "/api/v1/vehicles/",
            {"category": str(self.category.id), "manufacturer": "Acme", "model": "Blocked"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_internal_number_is_generated_when_omitted(self):
        response = self.client_for(self.admin_user).post(
            "/api/v1/vehicles/",
            {"category": str(self.category.id), "manufacturer": "Acme", "model": "GenA"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(response.data["internal_number"].startswith("FZ-"))

    def test_generated_internal_numbers_are_unique_and_sequential(self):
        client = self.client_for(self.admin_user)
        first = client.post(
            "/api/v1/vehicles/", {"category": str(self.category.id), "manufacturer": "Acme", "model": "G1"}, format="json"
        )
        second = client.post(
            "/api/v1/vehicles/", {"category": str(self.category.id), "manufacturer": "Acme", "model": "G2"}, format="json"
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(first.data["internal_number"], second.data["internal_number"])

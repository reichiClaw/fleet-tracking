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
from workflows.models import Loan, LoanStatus


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


class DashboardAPITests(DomainAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = VehicleCategory.objects.create(name="Dashboard")
        self.available_vehicle = Vehicle.objects.create(
            internal_number="VH-DASH-1",
            category=self.category,
            manufacturer="Acme",
            model="A1",
            status=VehicleStatus.AVAILABLE,
        )
        self.loaned_vehicle = Vehicle.objects.create(
            internal_number="VH-DASH-2",
            category=self.category,
            manufacturer="Acme",
            model="A2",
            status=VehicleStatus.LOANED,
        )

    def test_dashboard_status_summary_returns_counts_for_all_statuses(self):
        response = self.client_for(self.operations_user).get("/api/v1/dashboard/status-summary/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[VehicleStatus.AVAILABLE], 1)
        self.assertEqual(response.data[VehicleStatus.LOANED], 1)
        self.assertIn(VehicleStatus.ARCHIVED, response.data)

    def test_dashboard_overdue_loans_returns_active_overdue_loans(self):
        overdue = Loan.objects.create(
            vehicle=self.loaned_vehicle,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() - timedelta(hours=1),
            checkout_odometer_km=10,
            status=LoanStatus.ACTIVE,
            created_by=self.operations_user,
        )
        Loan.objects.create(
            vehicle=self.available_vehicle,
            borrower_name="Future",
            borrower_phone="456",
            expected_return_at=timezone.now() + timedelta(days=1),
            status=LoanStatus.ACTIVE,
            created_by=self.operations_user,
        )

        response = self.client_for(self.operations_user).get("/api/v1/dashboard/overdue-loans/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [str(overdue.id)])

    def test_dashboard_recent_activity_returns_audit_entries(self):
        AuditLog.objects.create(actor=self.admin_user, action="vehicle.created", entity_type="vehicle")

        response = self.client_for(self.operations_user).get("/api/v1/dashboard/recent-activity/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["action"], "vehicle.created")

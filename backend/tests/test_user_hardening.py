from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.views import UserViewSet
from audit.models import AuditLog


class UserHardeningTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.admin = users.objects.create_user(username="app-admin", password="Admin-old-9284!", role="admin")
        self.user = users.objects.create_user(username="reader", password="Reader-old-9284!", role="readonly")
        self.superuser = users.objects.create_superuser(username="root", password="Root-old-9284!")

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_application_admin_cannot_write_django_privilege_flags(self):
        create = self.client_for(self.admin).post(
            "/api/v1/users/",
            {
                "username": "escalated",
                "password": "Strong-new-9284!",
                "role": "admin",
                "is_staff": True,
                "is_superuser": True,
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(get_user_model().objects.filter(username="escalated").exists())

    def test_password_validation_and_safe_self_update(self):
        weak = self.client_for(self.user).post(
            f"/api/v1/users/{self.user.id}/set-password/",
            {"current_password": "Reader-old-9284!", "new_password": "password"},
            format="json",
        )
        wrong_current = self.client_for(self.user).post(
            f"/api/v1/users/{self.user.id}/set-password/",
            {"current_password": "wrong", "new_password": "Reader-new-9284!"},
            format="json",
        )
        valid = self.client_for(self.user).post(
            f"/api/v1/users/{self.user.id}/set-password/",
            {"current_password": "Reader-old-9284!", "new_password": "Reader-new-9284!"},
            format="json",
        )

        self.assertEqual(weak.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(wrong_current.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(valid.status_code, status.HTTP_204_NO_CONTENT)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Reader-new-9284!"))
        self.assertTrue(AuditLog.objects.filter(action="user.password_changed", entity_id=self.user.id).exists())

    def test_application_admin_can_reset_normal_user_but_not_superuser(self):
        reset = self.client_for(self.admin).post(
            f"/api/v1/users/{self.user.id}/set-password/",
            {"new_password": "Reader-reset-9284!"},
            format="json",
        )
        superuser_reset = self.client_for(self.admin).post(
            f"/api/v1/users/{self.superuser.id}/set-password/",
            {"new_password": "Root-reset-9284!"},
            format="json",
        )

        self.assertEqual(reset.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(superuser_reset.status_code, status.HTTP_404_NOT_FOUND)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Reader-reset-9284!"))

    def test_application_admin_must_use_user_deactivation_action(self):
        direct = self.client_for(self.admin).patch(
            f"/api/v1/users/{self.user.id}/",
            {"is_active": False},
            format="json",
        )
        deactivated = self.client_for(self.admin).post(
            f"/api/v1/users/{self.user.id}/deactivate/",
        )

        self.assertEqual(direct.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(deactivated.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

    def test_application_admin_cannot_deactivate_own_account(self):
        response = self.client_for(self.admin).post(
            f"/api/v1/users/{self.admin.id}/deactivate/",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_user_update_queryset_locks_active_and_privilege_fields(self):
        view = UserViewSet()
        view.action = "partial_update"
        view.request = SimpleNamespace(user=self.admin)

        self.assertTrue(view.get_queryset().query.select_for_update)

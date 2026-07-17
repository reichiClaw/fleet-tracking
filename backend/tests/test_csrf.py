"""CSRF bootstrap tests for the SPA session-auth flow.

These tests use ``enforce_csrf_checks=True`` to reproduce real browser behaviour
(the default test client disables CSRF), proving that authenticated writes work
once the CSRF cookie has been issued.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

LOGIN_URL = "/api/v1/auth/login/"
CSRF_URL = "/api/v1/auth/csrf/"
COMPANIES_URL = "/api/v1/companies/"


class CsrfFlowTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.user_model.objects.create_user(username="ops", password="secret", role="operations")

    def test_csrf_endpoint_sets_cookie(self):
        client = APIClient(enforce_csrf_checks=True)

        response = client.get(CSRF_URL)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIn("csrftoken", response.cookies)

    def test_me_endpoint_reissues_csrf_cookie_for_authenticated_session(self):
        client = APIClient(enforce_csrf_checks=True)
        client.get(CSRF_URL)
        token = client.cookies["csrftoken"].value
        login = client.post(
            LOGIN_URL,
            {"username": "ops", "password": "secret"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        # Simulate a reload where only the session cookie remains.
        client.cookies.pop("csrftoken", None)

        response = client.get("/api/v1/auth/me/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("csrftoken", response.cookies)

    def test_authenticated_write_requires_csrf_token_and_succeeds_with_it(self):
        client = APIClient(enforce_csrf_checks=True)
        client.get(CSRF_URL)
        token = client.cookies["csrftoken"].value
        login = client.post(
            LOGIN_URL,
            {"username": "ops", "password": "secret"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        token = client.cookies["csrftoken"].value

        without_token = client.post(
            COMPANIES_URL, {"name": "No CSRF", "company_type": "subcontractor"}, format="json"
        )
        self.assertEqual(without_token.status_code, status.HTTP_403_FORBIDDEN)

        with_token = client.post(
            COMPANIES_URL,
            {"name": "With CSRF", "company_type": "subcontractor"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(with_token.status_code, status.HTTP_201_CREATED)

    def test_login_requires_csrf_and_accepts_bootstrap_token(self):
        client = APIClient(enforce_csrf_checks=True)
        missing = client.post(LOGIN_URL, {"username": "ops", "password": "secret"}, format="json")
        self.assertEqual(missing.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(missing.json()["error"]["code"], "csrf_failed")

        client.get(CSRF_URL)
        token = client.cookies["csrftoken"].value
        valid = client.post(
            LOGIN_URL,
            {"username": "ops", "password": "secret"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(valid.status_code, status.HTTP_200_OK)

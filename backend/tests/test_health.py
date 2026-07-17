from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse


class HealthEndpointTests(SimpleTestCase):
    def test_health_endpoint_returns_ok(self):
        response = self.client.get(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_health_endpoint_allows_anonymous_requests(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)


class ReadinessEndpointTests(SimpleTestCase):
    databases = {"default"}

    def test_readiness_endpoint_reports_database_ok(self):
        response = self.client.get(reverse("readiness"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["database"], "ok")
        self.assertEqual(response.json()["media"], "ok")

    @patch("config.views.default_storage.exists", side_effect=OSError("storage unavailable"))
    def test_readiness_reports_unavailable_media(self, _exists):
        response = self.client.get(reverse("readiness"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(),
            {"status": "unavailable", "database": "ok", "media": "down"},
        )

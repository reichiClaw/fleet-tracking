"""Project-level API views."""

import logging

from django.core.files.storage import default_storage
from django.db import connection
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger("fleet")


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Return a lightweight liveness response for load balancers and Compose."""
    return Response(
        {
            "status": "ok",
            "detail": _("Service is healthy."),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def readiness(request):
    """Return readiness, including database connectivity.

    Useful as a deeper probe (orchestrators, deploy smoke checks) without
    changing the existing lightweight ``/api/health/`` liveness probe.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:  # pragma: no cover - exercised only when the DB is down
        logger.exception("Readiness check failed: database unavailable")
        return Response(
            {"status": "unavailable", "database": "down"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        # ``exists`` performs a harmless metadata request for local, SFTP, and
        # S3 storage and therefore verifies that the configured backend is
        # reachable without creating probe files.
        default_storage.exists(".fleet-readiness-probe")
    except Exception:  # pragma: no cover - depends on external media storage
        logger.exception("Readiness check failed: media storage unavailable")
        return Response(
            {"status": "unavailable", "database": "ok", "media": "down"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return Response({"status": "ok", "database": "ok", "media": "ok"})

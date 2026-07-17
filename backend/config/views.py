"""Project-level API views."""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.db.models import Q
from django.db import connection
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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


class FirstRunReadinessView(APIView):
    """Safe setup checklist; reports state only and never configuration secrets."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from accounts.permissions import is_admin
        from parties.models import Company
        from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
        from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol

        users = get_user_model()
        category_count = VehicleCategory.objects.filter(is_active=True).count()
        partner_count = Company.objects.filter(
            is_active=True,
            company_type__in=[Company.CompanyType.SUPPLIER, Company.CompanyType.MANUFACTURER],
        ).count()
        user_count = users.objects.filter(is_active=True).count()
        vehicle_count = Vehicle.objects.count()
        announced_count = Vehicle.objects.filter(status=VehicleStatus.ANNOUNCED).count()
        qr_missing = Vehicle.objects.filter(Q(qr_code="") | Q(qr_code__isnull=True)).count()
        failed_documents = (
            CheckInProtocol.objects.exclude(pdf_generation_error="").count()
            + ManufacturerCheckOutProtocol.objects.exclude(pdf_generation_error="").count()
            + Loan.objects.filter(
                Q(checkout_pdf_generation_error__gt="") | Q(return_pdf_generation_error__gt="")
            ).count()
        )
        backup_state = settings.BACKUP_STATUS.strip().casefold()
        backup_configured = bool(backup_state)
        safe_backup_states = {
            "ok",
            "ready",
            "configured",
            "warning",
            "failed",
            "unavailable",
            "unknown",
        }
        safe_backup_status = (
            backup_state if backup_state in safe_backup_states else "configured"
        )
        checklist = [
            {"id": "categories", "ready": category_count > 0, "count": category_count},
            {"id": "supplier_or_manufacturer", "ready": partner_count > 0, "count": partner_count},
            {"id": "users", "ready": user_count > 0, "count": user_count},
            {
                "id": "vehicles",
                "ready": vehicle_count > 0,
                "count": vehicle_count,
                "announced_awaiting_check_in": announced_count,
            },
            {"id": "qr_codes", "ready": qr_missing == 0, "missing_count": qr_missing},
            {"id": "documents", "ready": failed_documents == 0, "failed_count": failed_documents},
            {
                "id": "backup",
                "ready": backup_configured and backup_state in {"ok", "ready", "configured"},
                "configured": backup_configured,
                "status": safe_backup_status if backup_configured else "unavailable",
            },
        ]
        return Response(
            {
                "ready": all(item["ready"] for item in checklist),
                "effective_role": "admin" if is_admin(request.user) else request.user.role,
                "capabilities": {"is_app_admin": is_admin(request.user)},
                "admin_security": {
                    "active_admin_exists": users.objects.filter(
                        Q(is_superuser=True) | Q(role="admin"),
                        is_active=True,
                    ).exists(),
                    "superuser_count": users.objects.filter(is_superuser=True, is_active=True).count(),
                    "temporary_password_count": users.objects.filter(
                        must_change_password=True,
                        is_active=True,
                    ).count(),
                    "debug": settings.DEBUG,
                    "secure_cookies": settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE,
                },
                "checklist": checklist,
            }
        )

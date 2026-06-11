"""Project-level API views."""

from django.db import connection
from django.db.models import Count
from django.utils.translation import gettext_lazy as _
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from audit.models import AuditLog
from audit.serializers import AuditLogSerializer
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import Loan, LoanStatus
from workflows.serializers import LoanSerializer


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Return a health response for load balancers and Compose."""
    database_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        database_ok = False
    return Response(
        {
            "status": "ok" if database_ok else "degraded",
            "detail": _("Service is healthy."),
            "checks": {"database": database_ok},
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard_status_summary(request):
    """Return vehicle counts keyed by stable status code."""
    counts = {status: 0 for status, _label in VehicleStatus.choices}
    for row in Vehicle.objects.values("status").annotate(total=Count("id")):
        counts[row["status"]] = row["total"]
    return Response(counts)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard_overdue_loans(request):
    """Return active loans whose expected return is in the past."""
    queryset = (
        Loan.objects.select_related("vehicle", "company", "driver", "created_by", "returned_by")
        .filter(status=LoanStatus.ACTIVE, expected_return_at__lt=timezone_now())
        .order_by("expected_return_at")
    )
    return Response(LoanSerializer(queryset[:25], many=True, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard_recent_activity(request):
    """Return recent auditable activity for the dashboard."""
    queryset = AuditLog.objects.select_related("actor").order_by("-created_at")[:25]
    return Response(AuditLogSerializer(queryset, many=True, context={"request": request}).data)


def timezone_now():
    from django.utils import timezone

    return timezone.now()

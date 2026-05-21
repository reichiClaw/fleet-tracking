"""Audit log API viewsets."""

from rest_framework import viewsets

from accounts.permissions import AdminReadOnly
from audit.models import AuditLog
from audit.serializers import AuditLogSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [AdminReadOnly]

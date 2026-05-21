"""Damage report API viewsets."""

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from damages.models import DamageReport
from damages.serializers import DamageReportSerializer


class DamageReportViewSet(viewsets.ModelViewSet):
    queryset = DamageReport.objects.select_related(
        "vehicle", "loan", "check_in_protocol", "manufacturer_checkout_protocol", "created_by"
    ).all()
    serializer_class = DamageReportSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        damage = self.get_object()
        damage.resolved_at = timezone.now()
        damage.save(update_fields=["resolved_at", "updated_at"])
        return Response(self.get_serializer(damage).data)

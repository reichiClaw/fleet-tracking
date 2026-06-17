"""Company API viewsets."""

from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, IsAdminRole
from audit.models import AuditLog
from parties.models import Company
from parties.serializers import CompanySerializer


class CompanyViewSet(viewsets.ModelViewSet):
    queryset = Company.objects.all().order_by("name")
    serializer_class = CompanySerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        company = self.get_object()
        company.is_active = False
        company.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(company).data)

    def perform_destroy(self, instance):
        # Deleting a company also removes its drivers (the user is warned and
        # confirms in the UI first). Done atomically with an audit record.
        with transaction.atomic():
            drivers = list(instance.drivers.all())
            driver_count = len(drivers)
            company_id = instance.id
            company_name = instance.name
            instance.drivers.all().delete()
            instance.delete()
            AuditLog.objects.create(
                actor=self.request.user,
                action="company.deleted",
                entity_type="company",
                entity_id=company_id,
                before={"name": company_name, "drivers_deleted": driver_count},
                after={},
                ip_address=self.request.META.get("REMOTE_ADDR") or None,
                user_agent=self.request.META.get("HTTP_USER_AGENT", ""),
            )

"""Company API viewsets."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, IsAdminRole
from audit.mixins import AuditedModelViewSetMixin
from audit.services import audit_event
from config.request import request_metadata
from parties.models import Company
from parties.serializers import CompanySerializer


class CompanyViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = Company.objects.all().order_by("name")
    serializer_class = CompanySerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        company = self.get_object()
        before = self._audit_snapshot(company)
        company.is_active = False
        company.save(update_fields=["is_active", "updated_at"])
        audit_event(
            actor=request.user,
            action="company.deactivated",
            entity_type="company",
            entity_id=company.id,
            before=before,
            after=self._audit_snapshot(company),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(company).data)

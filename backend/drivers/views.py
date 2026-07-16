"""Driver API viewsets."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, IsAdminRole
from audit.mixins import AuditedModelViewSetMixin
from audit.services import audit_event
from config.request import request_metadata
from drivers.models import Driver
from drivers.serializers import DriverSerializer


class DriverViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = Driver.objects.select_related("company").all().order_by("last_name", "first_name")
    serializer_class = DriverSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        driver = self.get_object()
        before = self._audit_snapshot(driver)
        driver.is_active = False
        driver.save(update_fields=["is_active", "updated_at"])
        audit_event(
            actor=request.user,
            action="driver.deactivated",
            entity_type="driver",
            entity_id=driver.id,
            before=before,
            after=self._audit_snapshot(driver),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(driver).data)

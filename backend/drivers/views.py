"""Driver API viewsets."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, IsAdminRole
from drivers.models import Driver
from drivers.serializers import DriverSerializer


class DriverViewSet(viewsets.ModelViewSet):
    queryset = Driver.objects.select_related("company").all().order_by("last_name", "first_name")
    serializer_class = DriverSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        driver = self.get_object()
        driver.is_active = False
        driver.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(driver).data)

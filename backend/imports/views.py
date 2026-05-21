"""Import job metadata API viewsets."""

from rest_framework import viewsets

from accounts.permissions import IsAdminRole
from imports.models import ImportJob
from imports.serializers import ImportJobSerializer


class ImportJobViewSet(viewsets.ModelViewSet):
    queryset = ImportJob.objects.select_related("source_media", "created_by").all()
    serializer_class = ImportJobSerializer
    permission_classes = [IsAdminRole]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

"""Media metadata API viewsets."""

from rest_framework import viewsets

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from mediafiles.models import MediaFile
from mediafiles.serializers import MediaFileSerializer


class MediaFileViewSet(viewsets.ModelViewSet):
    queryset = MediaFile.objects.select_related("vehicle", "loan", "damage_report", "uploaded_by").all()
    serializer_class = MediaFileSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

"""Media metadata and secure file download API viewsets."""

from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from mediafiles.models import MediaFile, MediaType
from mediafiles.serializers import MediaFileSerializer, MediaFileUploadSerializer


class MediaDownloadMixin:
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        media = self.get_object()
        if not default_storage.exists(media.storage_key):
            raise Http404("Media file not found.")
        response = FileResponse(
            default_storage.open(media.storage_key, "rb"),
            content_type=media.content_type,
            as_attachment=True,
            filename=media.original_filename,
        )
        response["Content-Length"] = str(media.size_bytes)
        response["X-Content-Type-Options"] = "nosniff"
        return response


class MediaFileViewSet(MediaDownloadMixin, viewsets.ModelViewSet):
    queryset = MediaFile.objects.select_related("vehicle", "loan", "damage_report", "uploaded_by").all()
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def get_serializer_class(self):
        if self.action == "create":
            return MediaFileUploadSerializer
        return MediaFileSerializer


class GeneratedDocumentViewSet(MediaDownloadMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = MediaFile.objects.select_related("vehicle", "loan", "damage_report", "uploaded_by").filter(
        media_type=MediaType.PDF
    )
    serializer_class = MediaFileSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

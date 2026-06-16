"""Media metadata and secure file download API viewsets."""

from django.core.files.storage import default_storage
from django.db.models import Q
from django.http import FileResponse, Http404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from mediafiles.models import MediaFile, MediaType
from mediafiles.serializers import GeneratedDocumentSerializer, MediaFileSerializer, MediaFileUploadSerializer


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
    """Searchable list of generated PDF reports (check-in, loan, manufacturer)."""

    serializer_class = GeneratedDocumentSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def get_queryset(self):
        queryset = (
            MediaFile.objects.select_related("vehicle", "loan", "uploaded_by")
            .filter(media_type=MediaType.PDF)
            .order_by("-created_at")
        )
        params = self.request.query_params
        document_type = params.get("type")
        vehicle = params.get("vehicle")
        language = params.get("language")
        search = params.get("search")
        if document_type:
            queryset = queryset.filter(related_type=document_type)
        if vehicle:
            queryset = queryset.filter(vehicle_id=vehicle)
        if language:
            queryset = queryset.filter(language=language)
        if search:
            queryset = queryset.filter(
                Q(original_filename__icontains=search)
                | Q(vehicle__internal_number__icontains=search)
                | Q(vehicle__manufacturer__icontains=search)
                | Q(vehicle__model__icontains=search)
                | Q(loan__borrower_name__icontains=search)
            )
        return queryset

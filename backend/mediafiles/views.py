"""Media metadata and secure file download API viewsets."""

from django.core.files.storage import default_storage
from django.db.models import Q
from django.db import transaction
from django.http import FileResponse, Http404
from django.utils.translation import gettext as _
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, is_admin, is_operations
from audit.services import audit_event
from config.request import request_metadata
from mediafiles.models import MediaFile, MediaType
from mediafiles.serializers import GeneratedDocumentSerializer, MediaFileSerializer, MediaFileUploadSerializer
from mediafiles.services import cleanup_storage_file, validate_existing_media_file


class MediaDownloadMixin:
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        media = self.get_object()
        if not default_storage.exists(media.storage_key):
            raise Http404(_("Media file not found."))
        validate_existing_media_file(media)
        audit_event(
            actor=request.user,
            action="media.downloaded",
            entity_type="media_file",
            entity_id=media.id,
            after={"media_type": media.media_type, "sha256": media.content_sha256},
            request_meta=request_metadata(request),
        )
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
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return media_queryset_for_user(self.request.user, self.queryset)

    def get_serializer_class(self):
        if self.action == "create":
            return MediaFileUploadSerializer
        return MediaFileSerializer

    def get_throttles(self):
        if self.action == "create":
            self.throttle_scope = "media_upload"
            from rest_framework.throttling import ScopedRateThrottle

            return [ScopedRateThrottle()]
        return []

    @action(detail=True, methods=["post"])
    def discard(self, request, pk=None):
        with transaction.atomic():
            # Re-read under the same row lock used by workflow attachment. This
            # prevents a stale "staged" instance from deleting media that a
            # concurrent workflow has just attached.
            media = self.get_queryset().select_for_update().filter(pk=pk).first()
            if media is None:
                raise Http404
            if media.uploaded_by_id != request.user.pk:
                raise serializers.ValidationError(
                    {"media": _("You may only discard media that you uploaded.")}
                )
            if not media.is_staged:
                raise serializers.ValidationError({"media": _("Only staged media can be discarded.")})
            storage_key = media.storage_key
            audit_event(
                actor=request.user,
                action="media.discarded",
                entity_type="media_file",
                entity_id=media.id,
                before={"media_type": media.media_type, "sha256": media.content_sha256},
                request_meta=request_metadata(request),
            )
            media.delete()
            transaction.on_commit(lambda: cleanup_storage_file(storage_key))
        return Response(status=status.HTTP_204_NO_CONTENT)


class GeneratedDocumentViewSet(MediaDownloadMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Searchable list of generated PDF reports (check-in, loan, manufacturer)."""

    serializer_class = GeneratedDocumentSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def get_queryset(self):
        queryset = media_queryset_for_user(
            self.request.user,
            MediaFile.objects.select_related("vehicle", "loan", "uploaded_by")
            .filter(media_type=MediaType.PDF, is_generated=True)
        )
        queryset = queryset.order_by("-created_at")
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


def media_queryset_for_user(user, queryset=None):
    queryset = queryset if queryset is not None else MediaFile.objects.all()
    if is_admin(user):
        return queryset
    if is_operations(user):
        return queryset.exclude(media_type=MediaType.IMPORT).exclude(
            media_type=MediaType.PDF, is_generated=False
        ).filter(
            Q(attached_at__isnull=False) | Q(uploaded_by=user)
        )
    return queryset.filter(
        Q(media_type=MediaType.PDF, is_generated=True)
        | Q(media_type=MediaType.PHOTO, attached_at__isnull=False)
    )

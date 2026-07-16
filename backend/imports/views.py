"""Import job metadata and upload/commit API viewsets."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext as _
from rest_framework import serializers, status, viewsets
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminRole
from config.request import request_metadata
from imports.models import ImportJob
from imports.serializers import ImportJobSerializer
from imports.services import (
    commit_vehicle_import_job,
    create_vehicle_import_job,
    revalidate_vehicle_import_job,
)


class ImportJobViewSet(viewsets.ModelViewSet):
    queryset = ImportJob.objects.select_related("source_media", "created_by").all()
    serializer_class = ImportJobSerializer
    permission_classes = [IsAdminRole]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST")

    @action(detail=False, methods=["post"], url_path="vehicles")
    def vehicles(self, request):
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            raise serializers.ValidationError({"file": _("Import file is required.")})
        if uploaded_file.size <= 0:
            raise serializers.ValidationError({"file": _("Import file must not be empty.")})

        job = create_vehicle_import_job(
            uploaded_file=uploaded_file,
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def remap(self, request, pk=None):
        job = self.get_object()
        mapping = request.data.get("mapping")
        if mapping is not None and not isinstance(mapping, dict):
            raise serializers.ValidationError(
                {"mapping": _("Mapping must be an object of column to source index.")}
            )
        try:
            job = revalidate_vehicle_import_job(
                job=job,
                mapping=mapping,
                actor=request.user,
                request_meta=request_metadata(request),
            )
        except ValueError as exc:
            raise serializers.ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        job = self.get_object()
        try:
            job = commit_vehicle_import_job(job=job, actor=request.user, request_meta=request_metadata(request))
        except (ValueError, DjangoValidationError) as exc:
            message = "; ".join(exc.messages) if isinstance(exc, DjangoValidationError) else str(exc)
            raise serializers.ValidationError({"detail": message}) from exc
        return Response(self.get_serializer(job).data)

"""Import job metadata and upload/commit API viewsets."""

from django.utils.translation import gettext as _
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminRole
from imports.models import ImportJob
from imports.serializers import ImportJobSerializer
from imports.services import commit_vehicle_import_job, create_vehicle_import_job


class ImportJobViewSet(viewsets.ModelViewSet):
    queryset = ImportJob.objects.select_related("source_media", "created_by").all()
    serializer_class = ImportJobSerializer
    permission_classes = [IsAdminRole]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=["post"], url_path="vehicles")
    def vehicles(self, request):
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            return Response({"detail": _("Import file is required.")}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded_file.size <= 0:
            return Response({"detail": _("Import file must not be empty.")}, status=status.HTTP_400_BAD_REQUEST)

        job = create_vehicle_import_job(
            uploaded_file=uploaded_file,
            actor=request.user,
            request_meta=self._request_meta(request),
        )
        return Response(self.get_serializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        job = self.get_object()
        try:
            job = commit_vehicle_import_job(job=job, actor=request.user, request_meta=self._request_meta(request))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(job).data)

    def _request_meta(self, request) -> dict[str, str]:
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        ip_address = forwarded_for.split(",", 1)[0].strip() or request.META.get("REMOTE_ADDR", "")
        return {
            "ip_address": ip_address,
            "user_agent": request.META.get("HTTP_USER_AGENT", ""),
        }

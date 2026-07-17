"""Import job metadata and upload/commit API viewsets."""

import csv
from io import BytesIO

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpResponse
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
    EXPECTED_COLUMNS,
    commit_vehicle_import_job,
    create_vehicle_import_job,
    revalidate_vehicle_import_job,
    set_import_row_exclusions,
)
from openpyxl import Workbook


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

    @action(detail=True, methods=["post"], url_path="exclude-rows")
    def exclude_rows(self, request, pk=None):
        row_numbers = request.data.get("row_numbers", [])
        if not isinstance(row_numbers, list):
            raise serializers.ValidationError({"row_numbers": _("Row numbers must be a list.")})
        try:
            normalized = [int(value) for value in row_numbers]
            job = set_import_row_exclusions(
                job=self.get_object(),
                row_numbers=normalized,
                actor=request.user,
                request_meta=request_metadata(request),
            )
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({"row_numbers": str(exc)}) from exc
        return Response(self.get_serializer(job).data)

    @action(detail=False, methods=["get"], url_path="vehicle-template")
    def vehicle_template(self, request):
        language = getattr(request, "LANGUAGE_CODE", "de").split("-", 1)[0]
        translations = {
            "de": {
                "external_key": "Externe ID",
                "internal_number": "Interne Nummer",
                "category": "Kategorie",
                "manufacturer": "Hersteller",
                "model": "Modell",
                "serial_number": "Seriennummer",
                "license_plate": "Kennzeichen",
                "current_odometer_km": "Kilometerstand",
                "current_operating_hours": "Betriebsstunden",
                "current_location": "Standort",
                "supplier": "Lieferant",
                "notes": "Bemerkungen",
            },
            "en": {field: field for field in EXPECTED_COLUMNS},
        }
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Fahrzeuge" if language == "de" else "Vehicles"
        sheet.append([translations.get(language, translations["en"])[field] for field in EXPECTED_COLUMNS])
        sheet.append(["EXT-001", "", "Sonstiges", "Example", "Model", "", "", "", "", "", "", ""])
        buffer = BytesIO()
        workbook.save(buffer)
        workbook.close()
        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="vehicle-import-template-{language}.xlsx"'
        return response

    @action(detail=True, methods=["get"], url_path="errors-csv")
    def errors_csv(self, request, pk=None):
        job = self.get_object()
        language = getattr(request, "LANGUAGE_CODE", "de").split("-", 1)[0]
        headers = {
            "de": ["Zeile", "Feld", "Code", "Meldung"],
            "en": ["row", "field", "code", "message"],
        }
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="import-{job.id}-errors.csv"'
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow(headers.get(language, headers["en"]))
        for error in job.result.get("errors", []):
            writer.writerow(["", error.get("field", ""), error.get("code", ""), error.get("message", "")])
        for row in job.result.get("rows", []):
            for error in row.get("errors", []):
                writer.writerow(
                    [row.get("row_number"), error.get("field", ""), error.get("code", ""), error.get("message", "")]
                )
        return response

    @action(detail=True, methods=["get"], url_path="generated-ids-csv")
    def generated_ids_csv(self, request, pk=None):
        job = self.get_object()
        if job.status != ImportJob.Status.COMMITTED:
            raise serializers.ValidationError({"detail": _("Generated IDs are available only after commit.")})
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="import-{job.id}-generated-ids.csv"'
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow(["row", "action", "vehicle_id", "internal_number", "external_key"])
        for row in job.result.get("commit", {}).get("committed_rows", []):
            writer.writerow(
                [
                    row.get("row_number"),
                    row.get("action"),
                    row.get("vehicle_id"),
                    row.get("internal_number"),
                    row.get("external_key") or "",
                ]
            )
        return response

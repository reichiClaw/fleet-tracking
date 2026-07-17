"""Media metadata and secure file download API viewsets."""

from django.core.files.storage import default_storage
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q
from django.db import transaction
from django.http import FileResponse, Http404
from django.utils.translation import gettext as _
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, is_admin, is_operations
from audit.services import audit_event
from config.request import request_metadata
from mediafiles.models import MediaFile, MediaType
from mediafiles.serializers import GeneratedDocumentSerializer, MediaFileSerializer, MediaFileUploadSerializer
from mediafiles.services import cleanup_storage_file, validate_existing_media_file
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol
from workflows.pdf import (
    CHECK_IN_DOCUMENT,
    LOAN_CHECKOUT_DOCUMENT,
    LOAN_RETURN_DOCUMENT,
    MANUFACTURER_CHECKOUT_DOCUMENT,
    generate_check_in_pdf,
    generate_loan_checkout_pdf,
    generate_loan_return_pdf,
    generate_manufacturer_checkout_pdf,
)


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

    @action(detail=False, methods=["get"], url_path="register")
    def register(self, request):
        rows = _document_register_rows()
        params = request.query_params
        if params.get("status"):
            rows = [row for row in rows if row["status"] == params["status"]]
        if params.get("type"):
            rows = [row for row in rows if row["document_type"] == params["type"]]
        if params.get("language"):
            rows = [row for row in rows if row["language"] == params["language"]]
        search = (params.get("search") or params.get("plate") or "").casefold().strip()
        if search:
            rows = [
                row
                for row in rows
                if search in row["vehicle_label"].casefold()
                or search in (row["license_plate"] or "").casefold()
            ]
        rows.sort(key=lambda row: row["performed_at"], reverse=True)
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(page) if page is not None else Response(rows)

    @action(detail=False, methods=["post"], url_path="retry")
    def retry(self, request):
        items = request.data.get("items")
        if items is None:
            items = [
                {
                    "document_type": request.data.get("document_type"),
                    "record_id": request.data.get("record_id"),
                    "language": request.data.get("language"),
                }
            ]
        if not isinstance(items, list) or not items or len(items) > 100:
            raise serializers.ValidationError({"items": _("Provide between one and 100 document retry items.")})
        if len(items) > 1 and not is_admin(request.user):
            raise PermissionDenied(_("Bulk document retry is restricted to administrators."))
        results = []
        for item in items:
            try:
                media, error_field, record = _retry_document(
                    item=item,
                    actor=request.user,
                    request_meta=request_metadata(request),
                )
            except (ObjectDoesNotExist, TypeError, ValueError) as exc:
                raise serializers.ValidationError(
                    {"items": _("A requested document record does not exist.")}
                ) from exc
            # PDF generation updates the immutable link on a separately locked
            # model instance. Refresh before clearing the prior failure so this
            # save cannot accidentally present a stale null link as a mutation.
            record.refresh_from_db()
            if getattr(record, error_field):
                setattr(record, error_field, "")
                record.save(update_fields=[error_field, "updated_at"])
            results.append(GeneratedDocumentSerializer(media, context={"request": request}).data)
        audit_event(
            actor=request.user,
            action="document.bulk_retried" if len(items) > 1 else "document.retried",
            entity_type="document_register",
            after={"count": len(results), "items": items},
            request_meta=request_metadata(request),
        )
        return Response({"count": len(results), "results": results})


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


def _document_register_rows():
    default_language = settings.LANGUAGE_CODE.split("-", 1)[0]
    generated = {
        (item.related_type, item.related_id, item.language): item
        for item in MediaFile.objects.filter(media_type=MediaType.PDF, is_generated=True)
    }
    expected = []
    for record in CheckInProtocol.objects.select_related("vehicle"):
        expected.append(
            (
                CHECK_IN_DOCUMENT,
                record,
                record.performed_at,
                record.pdf_language or default_language,
                record.pdf_generation_error,
            )
        )
    for loan in Loan.objects.select_related("vehicle"):
        expected.append(
            (
                LOAN_CHECKOUT_DOCUMENT,
                loan,
                loan.created_at,
                loan.checkout_pdf_language or default_language,
                loan.checkout_pdf_generation_error,
            )
        )
        if loan.status == LoanStatus.RETURNED:
            expected.append(
                (
                    LOAN_RETURN_DOCUMENT,
                    loan,
                    loan.actual_return_at,
                    loan.return_pdf_language or default_language,
                    loan.return_pdf_generation_error,
                )
            )
    for record in ManufacturerCheckOutProtocol.objects.select_related("vehicle"):
        expected.append(
            (
                MANUFACTURER_CHECKOUT_DOCUMENT,
                record,
                record.performed_at,
                record.pdf_language or default_language,
                record.pdf_generation_error,
            )
        )
    rows = []
    for document_type, record, performed_at, language, failure_reason in expected:
        media = generated.get((document_type, record.id, language))
        state = "generated" if media else ("failed" if failure_reason else "missing")
        vehicle = record.vehicle
        rows.append(
            {
                "document_type": document_type,
                "record_id": str(record.id),
                "vehicle_id": str(vehicle.id),
                "vehicle_label": " · ".join(
                    value for value in (vehicle.internal_number, vehicle.manufacturer, vehicle.model) if value
                ),
                "license_plate": vehicle.license_plate,
                "performed_at": performed_at.isoformat(),
                "language": language,
                "status": state,
                "failure_reason": failure_reason or "",
                "media_id": str(media.id) if media else None,
                "retry": {
                    "method": "POST",
                    "url": "/api/v1/documents/retry/",
                    "document_type": document_type,
                    "record_id": str(record.id),
                    "language": language,
                }
                if state != "generated"
                else None,
            }
        )
    return rows


def _retry_document(*, item, actor, request_meta):
    document_type = item.get("document_type")
    record_id = item.get("record_id")
    language = item.get("language")
    if document_type == CHECK_IN_DOCUMENT:
        record = CheckInProtocol.objects.get(pk=record_id)
        return (
            generate_check_in_pdf(
                protocol=record,
                actor=actor,
                language=language,
                request_meta=request_meta,
            ),
            "pdf_generation_error",
            record,
        )
    if document_type == LOAN_CHECKOUT_DOCUMENT:
        record = Loan.objects.get(pk=record_id)
        return (
            generate_loan_checkout_pdf(
                loan=record,
                actor=actor,
                language=language,
                request_meta=request_meta,
            ),
            "checkout_pdf_generation_error",
            record,
        )
    if document_type == LOAN_RETURN_DOCUMENT:
        record = Loan.objects.get(pk=record_id)
        return (
            generate_loan_return_pdf(
                loan=record,
                actor=actor,
                language=language,
                request_meta=request_meta,
            ),
            "return_pdf_generation_error",
            record,
        )
    if document_type == MANUFACTURER_CHECKOUT_DOCUMENT:
        record = ManufacturerCheckOutProtocol.objects.get(pk=record_id)
        return (
            generate_manufacturer_checkout_pdf(
                protocol=record,
                actor=actor,
                language=language,
                request_meta=request_meta,
            ),
            "pdf_generation_error",
            record,
        )
    raise serializers.ValidationError({"document_type": _("Unsupported workflow document type.")})

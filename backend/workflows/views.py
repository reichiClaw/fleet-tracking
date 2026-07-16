"""Operational workflow API viewsets."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils.translation import gettext as _

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from audit.services import audit_event
from config.request import request_metadata
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol, Reservation, ReservationStatus
from workflows.serializers import (
    CheckInProtocolSerializer,
    CheckInWorkflowSerializer,
    LoanCheckoutWorkflowSerializer,
    LoanReturnWorkflowSerializer,
    LoanSerializer,
    ManufacturerCheckOutProtocolSerializer,
    ManufacturerCheckOutWorkflowSerializer,
    ReservationSerializer,
)
from mediafiles.serializers import MediaFileSerializer
from workflows.pdf import (
    generate_check_in_pdf,
    generate_loan_checkout_pdf,
    generate_loan_return_pdf,
    generate_manufacturer_checkout_pdf,
)
from workflows.services import (
    complete_check_in,
    complete_loan_checkout,
    complete_loan_return,
    complete_manufacturer_checkout,
)


class LoanViewSet(viewsets.ModelViewSet):
    queryset = Loan.objects.select_related(
        "vehicle", "company", "driver", "created_by", "returned_by", "checkout_pdf_media", "return_pdf_media"
    ).all()
    serializer_class = LoanSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        serializer = LoanCheckoutWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        loan = complete_loan_checkout(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
        )
        return Response(LoanSerializer(loan, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="return")
    def return_loan(self, request, pk=None):
        loan = self.get_object()
        serializer = LoanReturnWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        returned_loan = complete_loan_return(
            loan=loan,
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
        )
        return Response(LoanSerializer(returned_loan, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="generate-checkout-pdf")
    def generate_checkout_pdf(self, request, pk=None):
        media = generate_loan_checkout_pdf(
            loan=self.get_object(),
            actor=request.user,
            language=_pdf_language(request),
            request_meta=request_metadata(request),
        )
        return Response(MediaFileSerializer(media, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="generate-return-pdf")
    def generate_return_pdf(self, request, pk=None):
        media = generate_loan_return_pdf(
            loan=self.get_object(),
            actor=request.user,
            language=_pdf_language(request),
            request_meta=request_metadata(request),
        )
        return Response(MediaFileSerializer(media, context={"request": request}).data)


class CheckInProtocolViewSet(viewsets.ModelViewSet):
    queryset = CheckInProtocol.objects.select_related("vehicle", "performed_by", "supplier_company", "pdf_media").all()
    serializer_class = CheckInProtocolSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        serializer = CheckInWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        protocol = complete_check_in(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
            idempotency_key=_idempotency_key(request),
        )
        return Response(
            CheckInProtocolSerializer(protocol, context={"request": request}).data,
            status=status.HTTP_200_OK if getattr(protocol, "_idempotent_replay", False) else status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request, pk=None):
        media = generate_check_in_pdf(
            protocol=self.get_object(),
            actor=request.user,
            language=_pdf_language(request),
            request_meta=request_metadata(request),
        )
        return Response(MediaFileSerializer(media, context={"request": request}).data)


class ManufacturerCheckOutProtocolViewSet(viewsets.ModelViewSet):
    queryset = ManufacturerCheckOutProtocol.objects.select_related(
        "vehicle", "performed_by", "recipient_company", "pdf_media"
    ).all()
    serializer_class = ManufacturerCheckOutProtocolSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        serializer = ManufacturerCheckOutWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        protocol = complete_manufacturer_checkout(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
        )
        return Response(
            ManufacturerCheckOutProtocolSerializer(protocol, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request, pk=None):
        media = generate_manufacturer_checkout_pdf(
            protocol=self.get_object(),
            actor=request.user,
            language=_pdf_language(request),
            request_meta=request_metadata(request),
        )
        return Response(MediaFileSerializer(media, context={"request": request}).data)


class ReservationViewSet(viewsets.ModelViewSet):
    queryset = Reservation.objects.select_related("vehicle", "driver", "company", "created_by").all()
    serializer_class = ReservationSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        vehicle = self.request.query_params.get("vehicle")
        status_value = self.request.query_params.get("status")
        if vehicle:
            queryset = queryset.filter(vehicle_id=vehicle)
        if status_value:
            queryset = queryset.filter(status=status_value)
        return queryset

    def perform_create(self, serializer):
        from django.db import transaction
        from rest_framework import serializers as drf_serializers
        from vehicles.models import Vehicle

        with transaction.atomic():
            # PostgreSQL row locks serialize all reservation writers for one
            # vehicle without relying on SQLite-incompatible exclusion ranges.
            vehicle = Vehicle.objects.select_for_update().get(pk=serializer.validated_data["vehicle"].pk)
            start = serializer.validated_data["start_at"]
            end = serializer.validated_data["end_at"]
            if Reservation.objects.select_for_update().filter(
                vehicle=vehicle,
                status=ReservationStatus.ACTIVE,
                start_at__lt=end,
                end_at__gt=start,
            ).exists():
                raise drf_serializers.ValidationError(
                    {"start_at": _("This vehicle already has an active reservation that overlaps this period.")}
                )
            reservation = serializer.save(vehicle=vehicle, created_by=self.request.user)
            audit_event(
                actor=self.request.user,
                action="reservation.created",
                entity_type="reservation",
                entity_id=reservation.id,
                after={
                    "vehicle_id": str(vehicle.id),
                    "start_at": reservation.start_at.isoformat(),
                    "end_at": reservation.end_at.isoformat(),
                    "status": reservation.status,
                },
                request_meta=request_metadata(self.request),
            )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        reservation = self.get_object()
        before = {"status": reservation.status}
        reservation.status = ReservationStatus.CANCELLED
        reservation.save(update_fields=["status", "updated_at"])
        audit_event(
            actor=request.user,
            action="reservation.cancelled",
            entity_type="reservation",
            entity_id=reservation.id,
            before=before,
            after={"status": reservation.status},
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(reservation).data)


def _pdf_language(request) -> str | None:
    return request.data.get("language") or request.query_params.get("language")


def _workflow_language(request) -> str | None:
    # Auto-generated reports follow the requester's UI language (Accept-Language,
    # resolved by LocaleMiddleware) so the PDF records de/en correctly.
    return getattr(request, "LANGUAGE_CODE", None)


def _idempotency_key(request) -> str | None:
    from rest_framework import serializers

    value = request.headers.get("Idempotency-Key", "").strip()
    if len(value) > 128:
        raise serializers.ValidationError({"idempotency_key": _("Idempotency key is too long.")})
    return value or None

"""Operational workflow API viewsets."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
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
            request_meta=_request_meta(request),
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
            request_meta=_request_meta(request),
            language=_workflow_language(request),
        )
        return Response(LoanSerializer(returned_loan, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="generate-checkout-pdf")
    def generate_checkout_pdf(self, request, pk=None):
        media = generate_loan_checkout_pdf(
            loan=self.get_object(), actor=request.user, language=_pdf_language(request)
        )
        return Response(MediaFileSerializer(media, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="generate-return-pdf")
    def generate_return_pdf(self, request, pk=None):
        media = generate_loan_return_pdf(
            loan=self.get_object(), actor=request.user, language=_pdf_language(request)
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
            request_meta=_request_meta(request),
            language=_workflow_language(request),
        )
        return Response(
            CheckInProtocolSerializer(protocol, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request, pk=None):
        media = generate_check_in_pdf(
            protocol=self.get_object(), actor=request.user, language=_pdf_language(request)
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
            request_meta=_request_meta(request),
            language=_workflow_language(request),
        )
        return Response(
            ManufacturerCheckOutProtocolSerializer(protocol, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request, pk=None):
        media = generate_manufacturer_checkout_pdf(
            protocol=self.get_object(), actor=request.user, language=_pdf_language(request)
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
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        reservation = self.get_object()
        reservation.status = ReservationStatus.CANCELLED
        reservation.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(reservation).data)


def _pdf_language(request) -> str | None:
    return request.data.get("language") or request.query_params.get("language")


def _workflow_language(request) -> str | None:
    # Auto-generated reports follow the requester's UI language (Accept-Language,
    # resolved by LocaleMiddleware) so the PDF records de/en correctly.
    return getattr(request, "LANGUAGE_CODE", None)


def _request_meta(request) -> dict[str, str]:
    # Prefer the client IP forwarded by the reverse proxy (Nginx/Caddy set
    # X-Forwarded-For); fall back to the direct peer address.
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip_address = forwarded_for.split(",", 1)[0].strip() or request.META.get("REMOTE_ADDR", "")
    return {
        "ip_address": ip_address,
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
    }

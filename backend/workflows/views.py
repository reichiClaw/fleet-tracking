"""Operational workflow API viewsets."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol
from workflows.serializers import (
    CheckInProtocolSerializer,
    CheckInWorkflowSerializer,
    LoanCheckoutWorkflowSerializer,
    LoanReturnWorkflowSerializer,
    LoanSerializer,
    ManufacturerCheckOutProtocolSerializer,
    ManufacturerCheckOutWorkflowSerializer,
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


def _pdf_language(request) -> str | None:
    return request.data.get("language") or request.query_params.get("language")


def _request_meta(request) -> dict[str, str]:
    return {
        "ip_address": request.META.get("REMOTE_ADDR", ""),
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
    }

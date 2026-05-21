"""Operational workflow API viewsets."""

from rest_framework import viewsets

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol
from workflows.serializers import CheckInProtocolSerializer, LoanSerializer, ManufacturerCheckOutProtocolSerializer


class LoanViewSet(viewsets.ModelViewSet):
    queryset = Loan.objects.select_related("vehicle", "company", "driver", "created_by", "returned_by").all()
    serializer_class = LoanSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class CheckInProtocolViewSet(viewsets.ModelViewSet):
    queryset = CheckInProtocol.objects.select_related("vehicle", "performed_by", "supplier_company", "pdf_media").all()
    serializer_class = CheckInProtocolSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def perform_create(self, serializer):
        serializer.save(performed_by=self.request.user)


class ManufacturerCheckOutProtocolViewSet(viewsets.ModelViewSet):
    queryset = ManufacturerCheckOutProtocol.objects.select_related(
        "vehicle", "performed_by", "recipient_company", "pdf_media"
    ).all()
    serializer_class = ManufacturerCheckOutProtocolSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]

    def perform_create(self, serializer):
        serializer.save(performed_by=self.request.user)

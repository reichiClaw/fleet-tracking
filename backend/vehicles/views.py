"""Vehicle API viewsets."""

from __future__ import annotations

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import (
    AuthenticatedReadAdminOperationsWriteNoDelete,
    AuthenticatedReadAdminWrite,
    IsAdminRole,
    VehiclePermission,
)
from damages.serializers import DamageReportSerializer
from mediafiles.serializers import MediaFileSerializer
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from vehicles.serializers import VehicleCategorySerializer, VehicleSerializer
from workflows.models import LoanStatus
from workflows.serializers import (
    CheckInProtocolSerializer,
    LoanSerializer,
    ManufacturerCheckOutProtocolSerializer,
    ReservationSerializer,
)


class VehicleCategoryViewSet(viewsets.ModelViewSet):
    queryset = VehicleCategory.objects.all().order_by("name")
    serializer_class = VehicleCategorySerializer
    permission_classes = [AuthenticatedReadAdminWrite]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        category = self.get_object()
        category.is_active = False
        category.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(category).data)


class VehicleViewSet(viewsets.ModelViewSet):
    queryset = Vehicle.objects.select_related("category").all().order_by("internal_number")
    serializer_class = VehicleSerializer
    permission_classes = [VehiclePermission]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_value = self.request.query_params.get("status")
        category = self.request.query_params.get("category")
        is_available = self.request.query_params.get("is_available")
        search = self.request.query_params.get("search")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if category:
            queryset = queryset.filter(category_id=category)
        if is_available is not None:
            if is_available.lower() in {"1", "true", "yes"}:
                queryset = queryset.filter(status=VehicleStatus.AVAILABLE)
            elif is_available.lower() in {"0", "false", "no"}:
                queryset = queryset.exclude(status=VehicleStatus.AVAILABLE)
        if search:
            queryset = queryset.filter(internal_number__icontains=search) | queryset.filter(
                manufacturer__icontains=search
            ) | queryset.filter(model__icontains=search)
        return queryset.distinct()

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def archive(self, request, pk=None):
        vehicle = self.get_object()
        serializer = self.get_serializer(vehicle, data={"status": VehicleStatus.ARCHIVED}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(archived_at=timezone.now())
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="schedule-manufacturer-return", permission_classes=[AuthenticatedReadAdminOperationsWriteNoDelete])
    def schedule_manufacturer_return(self, request, pk=None):
        """Set or clear the date by which the vehicle must be sent back to the manufacturer."""
        vehicle = self.get_object()
        raw = request.data.get("manufacturer_return_due")
        if raw in (None, ""):
            vehicle.manufacturer_return_due = None
        else:
            parsed = parse_date(str(raw))
            if parsed is None:
                raise serializers.ValidationError({"manufacturer_return_due": "Enter a valid date (YYYY-MM-DD)."})
            vehicle.manufacturer_return_due = parsed
        vehicle.save(update_fields=["manufacturer_return_due", "updated_at"])
        return Response(VehicleSerializer(vehicle, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        vehicle = self.get_object()
        return Response(
            {
                "loans": LoanSerializer(vehicle.loans.all().order_by("-created_at"), many=True).data,
                "reservations": ReservationSerializer(
                    vehicle.reservations.all().order_by("start_at"), many=True
                ).data,
                "check_ins": CheckInProtocolSerializer(vehicle.check_in_protocols.all().order_by("-performed_at"), many=True).data,
                "manufacturer_checkouts": ManufacturerCheckOutProtocolSerializer(
                    vehicle.manufacturer_checkout_protocols.all().order_by("-performed_at"), many=True
                ).data,
                "damages": DamageReportSerializer(vehicle.damage_reports.all().order_by("-discovered_at"), many=True).data,
                "media": MediaFileSerializer(vehicle.media_files.all().order_by("-created_at"), many=True).data,
            }
        )

    @action(detail=True, methods=["get"])
    def media(self, request, pk=None):
        vehicle = self.get_object()
        return Response(MediaFileSerializer(vehicle.media_files.all().order_by("-created_at"), many=True).data)

    @action(detail=False, methods=["get"], url_path=r"qr/(?P<qr_code>[^/.]+)")
    def qr(self, request, qr_code=None):
        vehicle = self.get_queryset().filter(qr_code__iexact=qr_code).first()
        if vehicle is None:
            raise NotFound("Vehicle QR code was not found.")
        active_loan = vehicle.loans.filter(status=LoanStatus.ACTIVE).order_by("-created_at").first()
        return Response(
            {
                "vehicle": VehicleSerializer(vehicle, context={"request": request}).data,
                "active_loan": LoanSerializer(active_loan, context={"request": request}).data if active_loan else None,
            }
        )


class PublicVehicleStatusView(APIView):
    """Unauthenticated, privacy-safe vehicle status lookup by QR code.

    Scanning a vehicle's single QR code opens a status page that works without
    logging in. This endpoint returns only non-sensitive identity + status data
    (no borrower / loan details).
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, qr_code=None):
        vehicle = (
            Vehicle.objects.select_related("category").filter(qr_code__iexact=qr_code).first()
        )
        if vehicle is None:
            raise NotFound("Vehicle QR code was not found.")
        return Response(
            {
                "qr_code": vehicle.qr_code,
                "internal_number": vehicle.internal_number,
                "manufacturer": vehicle.manufacturer,
                "model": vehicle.model,
                "category": vehicle.category.name if vehicle.category else None,
                "status": vehicle.status,
                "license_plate": vehicle.license_plate,
                "serial_number": vehicle.serial_number,
                "current_location": vehicle.current_location,
            }
        )

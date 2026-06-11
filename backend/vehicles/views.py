"""Vehicle API viewsets."""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from audit.models import AuditLog
from accounts.permissions import AuthenticatedReadAdminWrite, IsAdminRole, VehiclePermission
from damages.serializers import DamageReportSerializer
from mediafiles.serializers import MediaFileSerializer
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from vehicles.serializers import VehicleCategorySerializer, VehicleSerializer
from workflows.models import LoanStatus
from workflows.serializers import CheckInProtocolSerializer, LoanSerializer, ManufacturerCheckOutProtocolSerializer


class VehicleCategoryViewSet(viewsets.ModelViewSet):
    queryset = VehicleCategory.objects.all().order_by("name")
    serializer_class = VehicleCategorySerializer
    permission_classes = [AuthenticatedReadAdminWrite]

    def perform_create(self, serializer):
        category = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="vehicle_category.created",
            entity_type="vehicle_category",
            entity_id=category.id,
            after=_category_snapshot(category),
        )

    def perform_update(self, serializer):
        before = _category_snapshot(serializer.instance)
        category = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="vehicle_category.updated",
            entity_type="vehicle_category",
            entity_id=category.id,
            before=before,
            after=_category_snapshot(category),
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        category = self.get_object()
        before = _category_snapshot(category)
        category.is_active = False
        category.save(update_fields=["is_active", "updated_at"])
        AuditLog.objects.create(
            actor=request.user,
            action="vehicle_category.deactivated",
            entity_type="vehicle_category",
            entity_id=category.id,
            before=before,
            after=_category_snapshot(category),
        )
        return Response(self.get_serializer(category).data)


class VehicleViewSet(viewsets.ModelViewSet):
    queryset = Vehicle.objects.select_related("category").all().order_by("internal_number")
    serializer_class = VehicleSerializer
    permission_classes = [VehiclePermission]

    def perform_create(self, serializer):
        vehicle = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="vehicle.created",
            entity_type="vehicle",
            entity_id=vehicle.id,
            after=_vehicle_snapshot(vehicle),
        )

    def perform_update(self, serializer):
        before = _vehicle_snapshot(serializer.instance)
        vehicle = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="vehicle.updated",
            entity_type="vehicle",
            entity_id=vehicle.id,
            before=before,
            after=_vehicle_snapshot(vehicle),
        )

    def get_queryset(self):
        queryset = super().get_queryset()
        status_value = self.request.query_params.get("status")
        category = self.request.query_params.get("category")
        manufacturer = self.request.query_params.get("manufacturer")
        location = self.request.query_params.get("location")
        expected_return_before = self.request.query_params.get("expected_return_before")
        is_available = self.request.query_params.get("is_available")
        search = self.request.query_params.get("search")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if category:
            queryset = queryset.filter(category_id=category)
        if manufacturer:
            queryset = queryset.filter(manufacturer__icontains=manufacturer)
        if location:
            queryset = queryset.filter(current_location__icontains=location)
        if expected_return_before:
            queryset = queryset.filter(
                loans__status="active",
                loans__expected_return_at__lte=expected_return_before,
            )
        if is_available is not None:
            if is_available.lower() in {"1", "true", "yes"}:
                queryset = queryset.filter(status=VehicleStatus.AVAILABLE)
            elif is_available.lower() in {"0", "false", "no"}:
                queryset = queryset.exclude(status=VehicleStatus.AVAILABLE)
        if search:
            queryset = queryset.filter(
                Q(internal_number__icontains=search)
                | Q(manufacturer__icontains=search)
                | Q(model__icontains=search)
                | Q(serial_number__icontains=search)
                | Q(license_plate__icontains=search)
            )
        return queryset.distinct()

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def archive(self, request, pk=None):
        vehicle = self.get_object()
        before = _vehicle_snapshot(vehicle)
        serializer = self.get_serializer(vehicle, data={"status": VehicleStatus.ARCHIVED}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(archived_at=timezone.now())
        AuditLog.objects.create(
            actor=request.user,
            action="vehicle.archived",
            entity_type="vehicle",
            entity_id=vehicle.id,
            before=before,
            after=_vehicle_snapshot(vehicle),
        )
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        vehicle = self.get_object()
        return Response(
            {
                "loans": LoanSerializer(vehicle.loans.all().order_by("-created_at"), many=True).data,
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


def _category_snapshot(category: VehicleCategory) -> dict[str, object]:
    return {
        "name": category.name,
        "description": category.description,
        "is_active": category.is_active,
    }


def _vehicle_snapshot(vehicle: Vehicle) -> dict[str, object]:
    return {
        "internal_number": vehicle.internal_number,
        "qr_code": vehicle.qr_code,
        "category": str(vehicle.category_id) if vehicle.category_id else None,
        "manufacturer": vehicle.manufacturer,
        "model": vehicle.model,
        "serial_number": vehicle.serial_number,
        "license_plate": vehicle.license_plate,
        "status": vehicle.status,
        "current_odometer_km": vehicle.current_odometer_km,
        "current_operating_hours": str(vehicle.current_operating_hours)
        if vehicle.current_operating_hours is not None
        else None,
        "current_location": vehicle.current_location,
        "archived_at": vehicle.archived_at.isoformat() if vehicle.archived_at else None,
    }

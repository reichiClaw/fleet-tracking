"""Vehicle API viewsets."""

from __future__ import annotations

from django.db.models import Count, Prefetch, Q
from django.db.models.functions import Now
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.translation import gettext as _
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
from audit.mixins import AuditedModelViewSetMixin
from audit.services import audit_event
from config.request import request_metadata
from damages.models import DamageReport
from damages.serializers import DamageReportSerializer
from mediafiles.serializers import MediaFileSerializer
from mediafiles.views import media_queryset_for_user
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from vehicles.serializers import VehicleCategorySerializer, VehicleCreationSerializer, VehicleSerializer
from vehicles.services import (
    archive_vehicle,
    correct_vehicle_state,
    create_vehicle_with_condition,
    unarchive_vehicle,
)
from workflows.models import Loan, LoanStatus, MaintenanceRecord, Reservation, ReservationStatus
from workflows.serializers import (
    CheckInProtocolSerializer,
    LoanSerializer,
    ManufacturerCheckOutProtocolSerializer,
    MaintenanceCompleteSerializer,
    MaintenanceRecordSerializer,
    MaintenanceStartSerializer,
    ReservationSerializer,
)
from workflows.services import complete_maintenance, start_maintenance


class VehicleCategoryViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = VehicleCategory.objects.annotate(vehicle_count=Count("vehicles")).order_by("name")
    serializer_class = VehicleCategorySerializer
    permission_classes = [AuthenticatedReadAdminWrite]
    audit_entity_type = "vehicle_category"
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        category = self.get_object()
        before = self._audit_snapshot(category)
        category.is_active = False
        category.save(update_fields=["is_active", "updated_at"])
        audit_event(
            actor=request.user,
            action="vehicle_category.deactivated",
            entity_type="vehicle_category",
            entity_id=category.id,
            before=before,
            after=self._audit_snapshot(category),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(category).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def reactivate(self, request, pk=None):
        category = self.get_object()
        before = self._audit_snapshot(category)
        category.is_active = True
        category.save(update_fields=["is_active", "updated_at"])
        audit_event(
            actor=request.user,
            action="vehicle_category.reactivated",
            entity_type="vehicle_category",
            entity_id=category.id,
            before=before,
            after=self._audit_snapshot(category),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(category).data)


class VehicleViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = (
        Vehicle.objects.select_related("category", "archived_by")
        .prefetch_related(
            Prefetch(
                "loans",
                queryset=Loan.objects.filter(status=LoanStatus.ACTIVE).select_related("company", "driver"),
                to_attr="_active_loans",
            ),
            Prefetch(
                "damage_reports",
                queryset=DamageReport.objects.filter(resolved_at__isnull=True),
                to_attr="_open_damages",
            ),
            Prefetch(
                "reservations",
                queryset=Reservation.objects.filter(
                    status=ReservationStatus.ACTIVE,
                    end_at__gte=Now(),
                ).order_by("start_at"),
                to_attr="_active_reservations",
            ),
        )
        .all()
        .order_by("internal_number")
    )
    serializer_class = VehicleSerializer
    permission_classes = [VehiclePermission]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return VehicleCreationSerializer
        return VehicleSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vehicle = create_vehicle_with_condition(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(
            VehicleSerializer(vehicle, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def get_queryset(self):
        queryset = super().get_queryset()
        status_value = self.request.query_params.get("status")
        category = self.request.query_params.get("category")
        is_available = self.request.query_params.get("is_available")
        search = self.request.query_params.get("search")
        manufacturer = self.request.query_params.get("manufacturer")
        location = self.request.query_params.get("location")
        active = self.request.query_params.get("active")
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
            queryset = queryset.filter(
                Q(internal_number__icontains=search)
                | Q(manufacturer__icontains=search)
                | Q(model__icontains=search)
                | Q(serial_number__icontains=search)
                | Q(license_plate__icontains=search)
                | Q(external_key__icontains=search)
            )
        if manufacturer:
            queryset = queryset.filter(manufacturer__icontains=manufacturer)
        if location:
            queryset = queryset.filter(current_location__icontains=location)
        if active and active.lower() in {"1", "true", "yes"}:
            queryset = queryset.exclude(
                status__in=[VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT]
            )
        elif active and active.lower() in {"0", "false", "no"}:
            queryset = queryset.filter(
                status__in=[VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT]
            )
        if getattr(self, "action", None) in {"update", "partial_update"}:
            queryset = queryset.select_for_update()
        return queryset.distinct()

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def archive(self, request, pk=None):
        vehicle = archive_vehicle(
            vehicle=self.get_object(),
            reason=str(request.data.get("reason", "")),
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def unarchive(self, request, pk=None):
        vehicle = unarchive_vehicle(
            vehicle=self.get_object(),
            reason=str(request.data.get("reason", "")),
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["post"], url_path="admin-correct", permission_classes=[IsAdminRole])
    def admin_correct(self, request, pk=None):
        allowed = {
            VehicleStatus.ANNOUNCED,
            VehicleStatus.CHECKED_IN,
            VehicleStatus.AVAILABLE,
            VehicleStatus.DAMAGED,
            VehicleStatus.MAINTENANCE,
        }
        target = request.data.get("status")
        if target is not None and target not in allowed:
            raise serializers.ValidationError({"status": _("This status cannot be set by correction.")})
        odometer = request.data.get("current_odometer_km")
        hours = request.data.get("current_operating_hours")
        try:
            odometer = int(odometer) if odometer is not None else None
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({"current_odometer_km": _("Enter a non-negative integer.")}) from exc
        vehicle = correct_vehicle_state(
            vehicle=self.get_object(),
            reason=str(request.data.get("reason", "")),
            actor=request.user,
            status=target,
            odometer_km=odometer,
            operating_hours=hours,
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(vehicle).data)

    @action(
        detail=True,
        methods=["post"],
        url_path="send-to-maintenance",
        permission_classes=[AuthenticatedReadAdminOperationsWriteNoDelete],
    )
    def send_to_maintenance(self, request, pk=None):
        serializer = MaintenanceStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = start_maintenance(
            vehicle=self.get_object(),
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(
            {
                "maintenance": MaintenanceRecordSerializer(record).data,
                "vehicle": VehicleSerializer(record.vehicle, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="complete-maintenance",
        permission_classes=[AuthenticatedReadAdminOperationsWriteNoDelete],
    )
    def complete_maintenance_action(self, request, pk=None):
        serializer = MaintenanceCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = complete_maintenance(
            vehicle=self.get_object(),
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(
            {
                "maintenance": MaintenanceRecordSerializer(record).data,
                "vehicle": VehicleSerializer(record.vehicle, context={"request": request}).data,
            }
        )

    @action(detail=True, methods=["get"], url_path="active-loan")
    def active_loan(self, request, pk=None):
        loan = self.get_object().loans.filter(status=LoanStatus.ACTIVE).first()
        if loan is None:
            raise NotFound(_("This vehicle has no active loan."))
        return Response(LoanSerializer(loan, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="workflow-context")
    def workflow_context(self, request, pk=None):
        vehicle = self.get_object()
        open_damages = vehicle.damage_reports.filter(resolved_at__isnull=True).order_by("discovered_at")
        active_reservations = vehicle.reservations.filter(
            status=ReservationStatus.ACTIVE,
            end_at__gte=timezone.now(),
        ).order_by("start_at")
        active_maintenance = vehicle.maintenance_records.filter(status="active").first()
        return Response(
            {
                "vehicle": VehicleSerializer(vehicle, context={"request": request}).data,
                "meter": {
                    "mode": vehicle.category.meter_mode,
                    "odometer_km": vehicle.current_odometer_km,
                    "operating_hours": (
                        str(vehicle.current_operating_hours)
                        if vehicle.current_operating_hours is not None
                        else None
                    ),
                },
                "active_loan": LoanSerializer(
                    vehicle.loans.filter(status=LoanStatus.ACTIVE).first(),
                    context={"request": request},
                ).data
                if vehicle.loans.filter(status=LoanStatus.ACTIVE).exists()
                else None,
                "open_damages": DamageReportSerializer(open_damages, many=True).data,
                "reservations": ReservationSerializer(active_reservations, many=True).data,
                "active_maintenance": (
                    MaintenanceRecordSerializer(active_maintenance).data if active_maintenance else None
                ),
                "capabilities": VehicleSerializer(
                    vehicle,
                    context={"request": request},
                ).data["capabilities"],
            }
        )

    @action(detail=True, methods=["post"], url_path="schedule-manufacturer-return", permission_classes=[AuthenticatedReadAdminOperationsWriteNoDelete])
    def schedule_manufacturer_return(self, request, pk=None):
        """Set or clear the date by which the vehicle must be sent back to the manufacturer."""
        vehicle = self.get_object()
        before = {"manufacturer_return_due": vehicle.manufacturer_return_due.isoformat() if vehicle.manufacturer_return_due else None}
        raw = request.data.get("manufacturer_return_due")
        if raw in (None, ""):
            vehicle.manufacturer_return_due = None
        else:
            parsed = parse_date(str(raw))
            if parsed is None:
                raise serializers.ValidationError(
                    {"manufacturer_return_due": _("Enter a valid date (YYYY-MM-DD).")}
                )
            vehicle.manufacturer_return_due = parsed
        vehicle.save(update_fields=["manufacturer_return_due", "updated_at"])
        audit_event(
            actor=request.user,
            action="vehicle.manufacturer_return_scheduled",
            entity_type="vehicle",
            entity_id=vehicle.id,
            before=before,
            after={
                "manufacturer_return_due": (
                    vehicle.manufacturer_return_due.isoformat() if vehicle.manufacturer_return_due else None
                )
            },
            request_meta=request_metadata(request),
        )
        return Response(VehicleSerializer(vehicle, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        vehicle = self.get_object()
        loans = list(vehicle.loans.all().order_by("-created_at"))
        check_ins = list(vehicle.check_in_protocols.all().order_by("-performed_at"))
        manufacturer = list(vehicle.manufacturer_checkout_protocols.all().order_by("-performed_at"))
        damages = list(vehicle.damage_reports.all().order_by("-discovered_at"))
        maintenance = list(vehicle.maintenance_records.all().order_by("-started_at"))
        timeline = []
        for item in check_ins:
            timeline.append(
                {
                    "occurred_at": item.performed_at.isoformat(),
                    "type": "check_in",
                    "id": str(item.id),
                    "status": "completed",
                }
            )
        for item in loans:
            timeline.append(
                {
                    "occurred_at": item.created_at.isoformat(),
                    "type": "loan_checkout",
                    "id": str(item.id),
                    "status": item.status,
                }
            )
            if item.actual_return_at:
                timeline.append(
                    {
                        "occurred_at": item.actual_return_at.isoformat(),
                        "type": "loan_return",
                        "id": str(item.id),
                        "status": item.return_condition_outcome,
                    }
                )
        for item in manufacturer:
            timeline.append(
                {
                    "occurred_at": item.performed_at.isoformat(),
                    "type": "manufacturer_return",
                    "id": str(item.id),
                    "status": "completed",
                }
            )
        for item in damages:
            timeline.append(
                {
                    "occurred_at": item.discovered_at.isoformat(),
                    "type": "damage_reported",
                    "id": str(item.id),
                    "status": "resolved" if item.resolved_at else "open",
                    "description": item.description,
                }
            )
            if item.resolved_at:
                timeline.append(
                    {
                        "occurred_at": item.resolved_at.isoformat(),
                        "type": "damage_resolved",
                        "id": str(item.id),
                        "status": "resolved",
                        "description": item.resolution_notes,
                    }
                )
        for item in maintenance:
            timeline.append(
                {
                    "occurred_at": item.started_at.isoformat(),
                    "type": "maintenance_start",
                    "id": str(item.id),
                    "status": item.status,
                    "description": item.reason,
                }
            )
            if item.completed_at:
                timeline.append(
                    {
                        "occurred_at": item.completed_at.isoformat(),
                        "type": "maintenance_complete",
                        "id": str(item.id),
                        "status": item.status,
                        "description": item.completion_notes,
                    }
                )
        timeline.sort(key=lambda event: event["occurred_at"], reverse=True)
        return Response(
            {
                "loans": LoanSerializer(loans, many=True).data,
                "reservations": ReservationSerializer(
                    vehicle.reservations.all().order_by("start_at"), many=True
                ).data,
                "check_ins": CheckInProtocolSerializer(check_ins, many=True).data,
                "manufacturer_checkouts": ManufacturerCheckOutProtocolSerializer(
                    manufacturer, many=True
                ).data,
                "damages": DamageReportSerializer(damages, many=True).data,
                "maintenance": MaintenanceRecordSerializer(maintenance, many=True).data,
                "timeline": timeline,
                "media": MediaFileSerializer(
                    media_queryset_for_user(request.user, vehicle.media_files.all()).order_by("-created_at"),
                    many=True,
                    context={"request": request},
                ).data,
            }
        )

    @action(detail=True, methods=["get"])
    def media(self, request, pk=None):
        vehicle = self.get_object()
        return Response(
            MediaFileSerializer(
                media_queryset_for_user(request.user, vehicle.media_files.all()).order_by("-created_at"),
                many=True,
                context={"request": request},
            ).data
        )

    @action(detail=False, methods=["get"], url_path="typeahead")
    def typeahead(self, request):
        queryset = self.filter_queryset(self.get_queryset()).exclude(
            status__in=[VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT]
        )
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(
            VehicleSerializer(page, many=True, context={"request": request}).data
        )

    @action(detail=False, methods=["get"], url_path="qr-bulk", permission_classes=[IsAdminRole])
    def qr_bulk(self, request):
        from django.conf import settings

        queryset = self.get_queryset()
        include_inactive = request.query_params.get("include_inactive", "").lower() in {"1", "true", "yes"}
        if not include_inactive:
            queryset = queryset.exclude(
                status__in=[VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT]
            )
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else queryset
        data = [
            {
                "id": str(vehicle.id),
                "qr_code": vehicle.qr_code,
                "internal_number": vehicle.internal_number,
                "license_plate": vehicle.license_plate,
                "status": vehicle.status,
                "label": " · ".join(
                    value
                    for value in (vehicle.internal_number, vehicle.manufacturer, vehicle.model)
                    if value
                ),
                "public_url": f"{settings.PUBLIC_BASE_URL.rstrip('/')}/v/{vehicle.qr_code}",
            }
            for vehicle in rows
        ]
        return self.get_paginated_response(data) if page is not None else Response(data)

    @action(detail=False, methods=["get"], url_path=r"qr/(?P<qr_code>[^/.]+)")
    def qr(self, request, qr_code=None):
        vehicle = self.get_queryset().filter(qr_code__iexact=qr_code).first()
        if vehicle is None:
            raise NotFound(_("Vehicle QR code was not found."))
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
            raise NotFound(_("Vehicle QR code was not found."))
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

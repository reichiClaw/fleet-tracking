"""Operational workflow API viewsets."""

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils.translation import gettext as _

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, is_admin
from audit.services import audit_event
from config.request import request_metadata
from workflows.drafts import DraftVersionConflict, discard_workflow_draft, upsert_workflow_draft
from workflows.models import (
    CheckInProtocol,
    Loan,
    LoanStatus,
    ManufacturerCheckOutProtocol,
    Reservation,
    ReservationStatus,
    WorkflowDraft,
)
from workflows.serializers import (
    CheckInProtocolSerializer,
    CheckInWorkflowSerializer,
    CreateAndCheckInWorkflowSerializer,
    LoanCheckoutWorkflowSerializer,
    LoanReturnWorkflowSerializer,
    LoanSerializer,
    ManufacturerCheckOutProtocolSerializer,
    ManufacturerCheckOutWorkflowSerializer,
    ReservationSerializer,
    WorkflowDraftSerializer,
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
    create_and_complete_check_in,
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

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("vehicle"):
            queryset = queryset.filter(vehicle_id=params["vehicle"])
        if params.get("company"):
            queryset = queryset.filter(company_id=params["company"])
        if params.get("driver"):
            queryset = queryset.filter(driver_id=params["driver"])
        if params.get("search"):
            search = params["search"].strip()
            queryset = queryset.filter(
                Q(vehicle__internal_number__icontains=search)
                | Q(vehicle__license_plate__icontains=search)
                | Q(borrower_name__icontains=search)
                | Q(borrower_phone__icontains=search)
                | Q(company__name__icontains=search)
                | Q(driver__first_name__icontains=search)
                | Q(driver__last_name__icontains=search)
            )
        return queryset.distinct()

    @action(detail=False, methods=["get"], url_path="typeahead")
    def typeahead(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        data = self.get_serializer(page if page is not None else queryset, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def create(self, request, *args, **kwargs):
        serializer = LoanCheckoutWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        loan = complete_loan_checkout(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
        )
        payload = LoanSerializer(loan, context={"request": request}).data
        payload["warnings"] = getattr(loan, "_warnings", [])
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="return")
    def return_loan(self, request, pk=None):
        loan = self.get_object()
        serializer = LoanReturnWorkflowSerializer(data=request.data, context={"request": request, "loan": loan})
        serializer.is_valid(raise_exception=True)
        returned_loan = complete_loan_return(
            loan=loan,
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
        )
        return Response(LoanSerializer(returned_loan, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="return-context")
    def return_context(self, request, pk=None):
        loan = self.get_object()
        vehicle = loan.vehicle
        open_damages = vehicle.damage_reports.filter(resolved_at__isnull=True).order_by("discovered_at")
        checkout_media = vehicle.media_files.filter(related_type="loan_checkout", related_id=loan.id).order_by(
            "created_at"
        )
        return Response(
            {
                "loan_id": str(loan.id),
                "status": loan.status,
                "vehicle": {
                    "id": str(vehicle.id),
                    "internal_number": vehicle.internal_number,
                    "manufacturer": vehicle.manufacturer,
                    "model": vehicle.model,
                    "license_plate": vehicle.license_plate,
                    "serial_number": vehicle.serial_number,
                    "status": vehicle.status,
                    "meter_mode": vehicle.category.meter_mode,
                    "current_odometer_km": vehicle.current_odometer_km,
                    "current_operating_hours": (
                        str(vehicle.current_operating_hours)
                        if vehicle.current_operating_hours is not None
                        else None
                    ),
                },
                "borrower": {
                    "name": loan.borrower_name,
                    "phone": loan.borrower_phone,
                    "company_id": str(loan.company_id) if loan.company_id else None,
                    "company_name": loan.company.name if loan.company_id else None,
                    "driver_id": str(loan.driver_id) if loan.driver_id else None,
                },
                "expected_return_at": loan.expected_return_at.isoformat(),
                "checkout": {
                    "snapshot": loan.checkout_snapshot,
                    "odometer_km": loan.checkout_odometer_km,
                    "operating_hours": (
                        str(loan.checkout_operating_hours)
                        if loan.checkout_operating_hours is not None
                        else None
                    ),
                    "media": MediaFileSerializer(
                        checkout_media,
                        many=True,
                        context={"request": request},
                    ).data,
                },
                "open_damages": [
                    {
                        "id": str(item.id),
                        "description": item.description,
                        "severity": item.severity,
                        "discovered_at": item.discovered_at.isoformat(),
                    }
                    for item in open_damages
                ],
                "signature_required": bool(settings.RETURN_SIGNATURE_REQUIRED),
            }
        )

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
            _workflow_response(
                CheckInProtocolSerializer(protocol, context={"request": request}).data,
                protocol.vehicle,
                request,
            ),
            status=status.HTTP_200_OK if getattr(protocol, "_idempotent_replay", False) else status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="create-and-check-in")
    def create_and_check_in(self, request):
        serializer = CreateAndCheckInWorkflowSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        protocol = create_and_complete_check_in(
            data=serializer.validated_data,
            actor=request.user,
            request_meta=request_metadata(request),
            language=_workflow_language(request),
            idempotency_key=_idempotency_key(request),
        )
        return Response(
            _workflow_response(
                CheckInProtocolSerializer(protocol, context={"request": request}).data,
                protocol.vehicle,
                request,
            ),
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
            _workflow_response(
                ManufacturerCheckOutProtocolSerializer(protocol, context={"request": request}).data,
                protocol.vehicle,
                request,
            ),
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
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        vehicle = self.request.query_params.get("vehicle")
        status_value = self.request.query_params.get("status")
        if vehicle:
            queryset = queryset.filter(vehicle_id=vehicle)
        if status_value:
            queryset = queryset.filter(status=status_value)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(vehicle__internal_number__icontains=search)
                | Q(vehicle__license_plate__icontains=search)
                | Q(reserved_for__icontains=search)
                | Q(manual_phone__icontains=search)
                | Q(company__name__icontains=search)
                | Q(driver__first_name__icontains=search)
                | Q(driver__last_name__icontains=search)
            )
        return queryset.distinct()

    @action(detail=False, methods=["get"], url_path="typeahead")
    def typeahead(self, request):
        queryset = self.filter_queryset(self.get_queryset().filter(status=ReservationStatus.ACTIVE))
        page = self.paginate_queryset(queryset)
        data = self.get_serializer(page if page is not None else queryset, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def perform_create(self, serializer):
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
                raise serializers.ValidationError(
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

    @transaction.atomic
    def perform_update(self, serializer):
        current = Reservation.objects.select_for_update().get(pk=serializer.instance.pk)
        if current.status != ReservationStatus.ACTIVE:
            raise serializers.ValidationError(
                {"reservation": _("Only active reservations can be edited.")}
            )
        vehicle = serializer.validated_data.get("vehicle", current.vehicle)
        from vehicles.models import Vehicle

        vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        start = serializer.validated_data.get("start_at", current.start_at)
        end = serializer.validated_data.get("end_at", current.end_at)
        if Reservation.objects.select_for_update().filter(
            vehicle=vehicle,
            status=ReservationStatus.ACTIVE,
            start_at__lt=end,
            end_at__gt=start,
        ).exclude(pk=current.pk).exists():
            raise serializers.ValidationError(
                {"start_at": _("This vehicle already has an active reservation that overlaps this period.")}
            )
        before = {
            "vehicle_id": str(current.vehicle_id),
            "start_at": current.start_at.isoformat(),
            "end_at": current.end_at.isoformat(),
            "party_snapshot": current.snapshot,
        }
        reservation = serializer.save()
        audit_event(
            actor=self.request.user,
            action="reservation.edited",
            entity_type="reservation",
            entity_id=reservation.id,
            before=before,
            after={
                "vehicle_id": str(reservation.vehicle_id),
                "start_at": reservation.start_at.isoformat(),
                "end_at": reservation.end_at.isoformat(),
                "party_snapshot": reservation.snapshot,
            },
            request_meta=request_metadata(self.request),
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            reservation = Reservation.objects.select_for_update().get(pk=self.get_object().pk)
            if reservation.status != ReservationStatus.ACTIVE:
                raise serializers.ValidationError(
                    {"reservation": _("Only active reservations can be cancelled.")}
                )
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

    @action(detail=True, methods=["post"], url_path="mark-no-show")
    def mark_no_show(self, request, pk=None):
        with transaction.atomic():
            reservation = Reservation.objects.select_for_update().get(pk=self.get_object().pk)
            if reservation.status != ReservationStatus.ACTIVE:
                raise serializers.ValidationError(
                    {"reservation": _("Only active reservations can be marked no-show.")}
                )
            if timezone.now() < reservation.start_at:
                raise serializers.ValidationError(
                    {"reservation": _("A reservation cannot be marked no-show before it starts.")}
                )
            reservation.status = ReservationStatus.NO_SHOW
            reservation.save(update_fields=["status", "updated_at"])
            audit_event(
                actor=request.user,
                action="reservation.no_show",
                entity_type="reservation",
                entity_id=reservation.id,
                before={"status": ReservationStatus.ACTIVE},
                after={"status": ReservationStatus.NO_SHOW},
                request_meta=request_metadata(request),
            )
        return Response(self.get_serializer(reservation).data)


class WorkflowDraftViewSet(viewsets.GenericViewSet):
    serializer_class = WorkflowDraftSerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    queryset = WorkflowDraft.objects.select_related("owner").all()
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset().filter(expires_at__gt=timezone.now())
        if not is_admin(self.request.user):
            queryset = queryset.filter(owner=self.request.user)
        elif self.request.query_params.get("owner"):
            queryset = queryset.filter(owner_id=self.request.query_params["owner"])
        if self.request.query_params.get("workflow_type"):
            queryset = queryset.filter(workflow_type=self.request.query_params["workflow_type"])
        return queryset

    def list(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(self.get_object()).data)

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            draft, created = upsert_workflow_draft(
                data=dict(serializer.validated_data),
                actor=request.user,
                request_meta=request_metadata(request),
            )
        except DraftVersionConflict as exc:
            return Response(
                {
                    "error": {
                        "code": "version_conflict",
                        "message": str(_("The workflow draft was updated by another request.")),
                        "details": {"current": self.get_serializer(exc.draft).data},
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            self.get_serializer(draft).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def discard(self, request, pk=None):
        draft = self.get_object()
        discard_workflow_draft(
            draft=draft,
            actor=request.user,
            request_meta=request_metadata(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


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


def _workflow_response(payload, vehicle, request):
    from vehicles.capabilities import vehicle_capabilities, vehicle_next_actions

    payload["capabilities"] = vehicle_capabilities(vehicle, request.user)
    payload["next_actions"] = vehicle_next_actions(vehicle, request.user)
    return payload

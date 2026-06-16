"""Serializers for operational workflow APIs."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from damages.models import DamageSeverity
from drivers.models import Driver
from mediafiles.models import MediaFile
from parties.models import Company
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol, Reservation, ReservationStatus


class LoanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Loan
        fields = [
            "id",
            "vehicle",
            "company",
            "driver",
            "borrower_name",
            "borrower_phone",
            "expected_return_at",
            "actual_return_at",
            "status",
            "checkout_odometer_km",
            "checkout_operating_hours",
            "return_odometer_km",
            "return_operating_hours",
            "checkout_notes",
            "return_notes",
            "checkout_pdf_media",
            "return_pdf_media",
            "checkout_pdf_language",
            "return_pdf_language",
            "created_by",
            "returned_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "checkout_pdf_media",
            "return_pdf_media",
            "created_by",
            "returned_by",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        driver = attrs.get("driver", getattr(self.instance, "driver", None))
        borrower_name = attrs.get("borrower_name", getattr(self.instance, "borrower_name", ""))
        if driver is None and not borrower_name:
            raise serializers.ValidationError(
                {"borrower_name": _("Borrower name is required when no driver is selected.")}
            )
        checkout_odometer = attrs.get("checkout_odometer_km", getattr(self.instance, "checkout_odometer_km", None))
        return_odometer = attrs.get("return_odometer_km", getattr(self.instance, "return_odometer_km", None))
        if checkout_odometer is not None and return_odometer is not None and return_odometer < checkout_odometer:
            raise serializers.ValidationError(
                {"return_odometer_km": _("Return odometer must not be lower than checkout odometer.")}
            )
        checkout_hours = attrs.get("checkout_operating_hours", getattr(self.instance, "checkout_operating_hours", None))
        return_hours = attrs.get("return_operating_hours", getattr(self.instance, "return_operating_hours", None))
        if checkout_hours is not None and return_hours is not None and return_hours < checkout_hours:
            raise serializers.ValidationError(
                {"return_operating_hours": _("Return operating hours must not be lower than checkout operating hours.")}
            )
        return attrs


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = [
            "id",
            "vehicle",
            "start_at",
            "end_at",
            "driver",
            "company",
            "reserved_for",
            "notes",
            "status",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = self.instance
        vehicle = attrs.get("vehicle", getattr(instance, "vehicle", None))
        start = attrs.get("start_at", getattr(instance, "start_at", None))
        end = attrs.get("end_at", getattr(instance, "end_at", None))
        # A reservation must name a driver from the database so we can detect when
        # a vehicle is loaned to the wrong driver (or is overdue) versus who
        # actually reserved it.
        driver = attrs.get("driver", getattr(instance, "driver", None))
        if driver is None:
            raise serializers.ValidationError(
                {"driver": _("Please select a driver from the database for the reservation.")}
            )
        if not attrs.get("reserved_for") and not getattr(instance, "reserved_for", ""):
            attrs["reserved_for"] = str(driver)
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": _("Reservation end must be after its start.")})
        if vehicle and start and end:
            overlapping = Reservation.objects.filter(
                vehicle=vehicle,
                status=ReservationStatus.ACTIVE,
                start_at__lt=end,
                end_at__gt=start,
            )
            if instance is not None:
                overlapping = overlapping.exclude(pk=instance.pk)
            if overlapping.exists():
                raise serializers.ValidationError(
                    {"start_at": _("This vehicle already has an active reservation that overlaps this period.")}
                )
        return attrs


class DamageReportInputSerializer(serializers.Serializer):
    description = serializers.CharField()
    severity = serializers.ChoiceField(choices=DamageSeverity.choices, required=False)
    discovered_at = serializers.DateTimeField(required=False)
    # Media is uploaded first via the media endpoint, then attached here by id so
    # every attached file has real stored bytes and a working download URL.
    media_file_ids = serializers.PrimaryKeyRelatedField(queryset=MediaFile.objects.all(), many=True, required=False)


class WorkflowMediaMixin(serializers.Serializer):
    media_file_ids = serializers.PrimaryKeyRelatedField(queryset=MediaFile.objects.all(), many=True, required=False)


class CheckInWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    performed_at = serializers.DateTimeField(required=False)
    supplier_company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    condition_notes = serializers.CharField(required=False, allow_blank=True)
    target_status = serializers.ChoiceField(
        choices=[VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED, VehicleStatus.MAINTENANCE],
        required=False,
    )
    damage_reports = DamageReportInputSerializer(many=True, required=False)


class LoanCheckoutWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all(), required=False, allow_null=True)
    borrower_name = serializers.CharField(required=False, allow_blank=True)
    borrower_phone = serializers.CharField(max_length=80, required=False, allow_blank=True)
    expected_return_at = serializers.DateTimeField()
    checkout_odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    checkout_operating_hours = serializers.DecimalField(
        max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True
    )
    checkout_notes = serializers.CharField(required=False, allow_blank=True)
    damage_reports = DamageReportInputSerializer(many=True, required=False)

    def validate(self, attrs):
        if attrs.get("driver") is None and not attrs.get("borrower_name"):
            raise serializers.ValidationError(
                {"borrower_name": _("Borrower name is required when no driver is selected.")}
            )
        return attrs


class LoanReturnWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    actual_return_at = serializers.DateTimeField(required=False)
    return_odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    return_operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    return_notes = serializers.CharField(required=False, allow_blank=True)
    target_status = serializers.ChoiceField(
        choices=[VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED, VehicleStatus.MAINTENANCE],
        required=False,
    )
    damage_reports = DamageReportInputSerializer(many=True, required=False)


class ManufacturerCheckOutWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    performed_at = serializers.DateTimeField(required=False)
    recipient_company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    condition_notes = serializers.CharField(required=False, allow_blank=True)
    damage_reports = DamageReportInputSerializer(many=True, required=False)


class CheckInProtocolSerializer(serializers.ModelSerializer):
    class Meta:
        model = CheckInProtocol
        fields = [
            "id",
            "vehicle",
            "performed_by",
            "performed_at",
            "supplier_company",
            "odometer_km",
            "operating_hours",
            "condition_notes",
            "pdf_media",
            "pdf_language",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "performed_by", "created_at", "updated_at"]


class ManufacturerCheckOutProtocolSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManufacturerCheckOutProtocol
        fields = [
            "id",
            "vehicle",
            "performed_by",
            "performed_at",
            "recipient_company",
            "odometer_km",
            "operating_hours",
            "condition_notes",
            "pdf_media",
            "pdf_language",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "performed_by", "created_at", "updated_at"]

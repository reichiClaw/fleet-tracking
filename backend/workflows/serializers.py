"""Serializers for operational workflow APIs."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from damages.models import DamageSeverity
from drivers.models import Driver
from mediafiles.models import MediaFile, MediaType
from parties.models import Company
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol


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
            "checkout_pdf_language",
            "return_pdf_language",
            "created_by",
            "returned_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "returned_by", "created_at", "updated_at"]

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


class MediaMetadataInputSerializer(serializers.Serializer):
    media_type = serializers.ChoiceField(choices=MediaType.choices)
    original_filename = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=120)
    size_bytes = serializers.IntegerField(min_value=1)


class DamageReportInputSerializer(serializers.Serializer):
    description = serializers.CharField()
    severity = serializers.ChoiceField(choices=DamageSeverity.choices, required=False)
    discovered_at = serializers.DateTimeField(required=False)
    media_files = MediaMetadataInputSerializer(many=True, required=False)
    media_file_ids = serializers.PrimaryKeyRelatedField(queryset=MediaFile.objects.all(), many=True, required=False)


class WorkflowMediaMixin(serializers.Serializer):
    media_files = MediaMetadataInputSerializer(many=True, required=False)
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
    borrower_phone = serializers.CharField(max_length=80)
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

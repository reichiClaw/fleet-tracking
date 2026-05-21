"""Serializers for operational workflow APIs."""

from rest_framework import serializers

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
            raise serializers.ValidationError({"borrower_name": "Borrower name is required when no driver is selected."})
        checkout_odometer = attrs.get("checkout_odometer_km", getattr(self.instance, "checkout_odometer_km", None))
        return_odometer = attrs.get("return_odometer_km", getattr(self.instance, "return_odometer_km", None))
        if checkout_odometer is not None and return_odometer is not None and return_odometer < checkout_odometer:
            raise serializers.ValidationError({"return_odometer_km": "Return odometer must not be lower than checkout odometer."})
        checkout_hours = attrs.get("checkout_operating_hours", getattr(self.instance, "checkout_operating_hours", None))
        return_hours = attrs.get("return_operating_hours", getattr(self.instance, "return_operating_hours", None))
        if checkout_hours is not None and return_hours is not None and return_hours < checkout_hours:
            raise serializers.ValidationError(
                {"return_operating_hours": "Return operating hours must not be lower than checkout operating hours."}
            )
        return attrs


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

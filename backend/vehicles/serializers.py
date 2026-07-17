"""Serializers for vehicle APIs."""

from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from vehicles.models import Vehicle, VehicleCategory, VehicleStatus, is_valid_status_transition

# Statuses that are owned by an operational workflow and the records it creates
# (a Loan, a manufacturer checkout protocol). They must not be set by editing the
# vehicle directly, otherwise the vehicle status and its related records drift
# apart (e.g. a vehicle flagged "loaned" with no Loan row).
WORKFLOW_MANAGED_STATUSES = {VehicleStatus.LOANED, VehicleStatus.MANUFACTURER_CHECKOUT}


class VehicleCategorySerializer(serializers.ModelSerializer):
    def validate_is_active(self, value):
        if self.instance and self.instance.is_active and not value:
            raise serializers.ValidationError(_("Use the dedicated deactivate action."))
        return value

    class Meta:
        model = VehicleCategory
        fields = ["id", "name", "description", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = [
            "id",
            "qr_code",
            "internal_number",
            "category",
            "manufacturer",
            "model",
            "serial_number",
            "license_plate",
            "status",
            "current_odometer_km",
            "current_operating_hours",
            "current_location",
            "notes",
            "manufacturer_return_due",
            "archived_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "qr_code", "archived_at", "created_at", "updated_at"]

    def validate(self, attrs):
        if self.instance is not None:
            current_status = self.instance.status
            new_status = attrs.get("status", current_status)
            if new_status != current_status:
                if new_status == VehicleStatus.ARCHIVED and not self.context.get("allow_archive"):
                    raise serializers.ValidationError(
                        {"status": _("Use the dedicated archive action.")}
                    )
                # Entering a workflow-managed status directly would bypass the
                # record (loan / manufacturer checkout) the status depends on.
                if new_status in WORKFLOW_MANAGED_STATUSES:
                    raise serializers.ValidationError(
                        {
                            "status": _(
                                "This status is set through its workflow (loan checkout or manufacturer "
                                "check-out), not by editing the vehicle directly."
                            )
                        }
                    )
                # Leaving "loaned" while a loan is still open would orphan that loan.
                if current_status == VehicleStatus.LOANED:
                    from workflows.models import Loan, LoanStatus

                    if Loan.objects.filter(vehicle=self.instance, status=LoanStatus.ACTIVE).exists():
                        raise serializers.ValidationError(
                            {"status": _("Return the active loan before changing this vehicle's status.")}
                        )
                if (
                    new_status == VehicleStatus.AVAILABLE
                    and self.instance.damage_reports.filter(resolved_at__isnull=True).exists()
                ):
                    raise serializers.ValidationError(
                        {"status": _("A vehicle with reported damage cannot be marked available.")}
                    )
            if not is_valid_status_transition(current_status, new_status):
                raise serializers.ValidationError(
                    {
                        "status": _(
                            "Invalid vehicle status transition from %(old)s to %(new)s."
                        )
                        % {"old": current_status, "new": new_status}
                    }
                )
            new_odometer = attrs.get("current_odometer_km", self.instance.current_odometer_km)
            if (
                self.instance.current_odometer_km is not None
                and new_odometer is not None
                and new_odometer < self.instance.current_odometer_km
            ):
                raise serializers.ValidationError(
                    {"current_odometer_km": _("Odometer value must not decrease.")}
                )
            new_hours = attrs.get("current_operating_hours", self.instance.current_operating_hours)
            if (
                self.instance.current_operating_hours is not None
                and new_hours is not None
                and new_hours < self.instance.current_operating_hours
            ):
                raise serializers.ValidationError(
                    {"current_operating_hours": _("Operating hours must not decrease.")}
                )
        return attrs


class InitialDamageSerializer(serializers.Serializer):
    description = serializers.CharField()
    severity = serializers.ChoiceField(choices=["minor", "major", "critical", "unknown"], required=False)
    media_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


class VehicleCreationSerializer(VehicleSerializer):
    media_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    initial_damage_reports = InitialDamageSerializer(many=True, required=False, write_only=True)

    class Meta(VehicleSerializer.Meta):
        fields = VehicleSerializer.Meta.fields + ["media_file_ids", "initial_damage_reports"]

    def validate_category(self, category):
        if not category.is_active:
            raise serializers.ValidationError(_("The selected vehicle category is inactive."))
        return category

    def validate_status(self, value):
        if value not in {VehicleStatus.ANNOUNCED, VehicleStatus.AVAILABLE}:
            raise serializers.ValidationError(
                _("New vehicles may only start as announced or available; damage is derived from initial reports.")
            )
        return value

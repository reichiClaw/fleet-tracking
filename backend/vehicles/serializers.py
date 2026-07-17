"""Serializers for vehicle APIs."""

from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from vehicles.capabilities import vehicle_capabilities, vehicle_next_actions
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus

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
        fields = ["id", "name", "description", "meter_mode", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class VehicleSerializer(serializers.ModelSerializer):
    meter_requirements = serializers.SerializerMethodField()
    active_loan = serializers.SerializerMethodField()
    open_damage_count = serializers.SerializerMethodField()
    reservation_summary = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    next_actions = serializers.SerializerMethodField()

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
            "external_key",
            "archived_at",
            "archived_by",
            "archive_reason",
            "meter_requirements",
            "active_loan",
            "open_damage_count",
            "reservation_summary",
            "capabilities",
            "next_actions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "qr_code",
            "status",
            "archived_at",
            "archived_by",
            "archive_reason",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        if self.instance is not None:
            if "status" in self.initial_data:
                raise serializers.ValidationError(
                    {"status": _("Use the dedicated workflow or admin correction action.")}
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

    def get_meter_requirements(self, obj):
        mode = obj.category.meter_mode
        return {
            "mode": mode,
            "requires_odometer": mode in {VehicleCategory.MeterMode.ODOMETER, VehicleCategory.MeterMode.BOTH},
            "requires_operating_hours": mode in {VehicleCategory.MeterMode.HOURS, VehicleCategory.MeterMode.BOTH},
            "current_odometer_km": obj.current_odometer_km,
            "current_operating_hours": (
                str(obj.current_operating_hours) if obj.current_operating_hours is not None else None
            ),
        }

    def get_active_loan(self, obj):
        loans = getattr(obj, "_active_loans", None)
        loan = loans[0] if loans else obj.loans.filter(status="active").order_by("-created_at").first()
        if not loan:
            return None
        return {
            "id": str(loan.id),
            "borrower_name": loan.borrower_name,
            "borrower_phone": loan.borrower_phone,
            "expected_return_at": loan.expected_return_at.isoformat(),
        }

    def get_open_damage_count(self, obj):
        prefetched = getattr(obj, "_open_damages", None)
        return len(prefetched) if prefetched is not None else obj.damage_reports.filter(resolved_at__isnull=True).count()

    def get_reservation_summary(self, obj):
        from django.utils import timezone

        reservations = getattr(obj, "_active_reservations", None)
        if reservations is None:
            reservations = list(
                obj.reservations.filter(status="active", end_at__gte=timezone.now()).order_by("start_at")[:2]
            )
        now = timezone.now()
        current = next((item for item in reservations if item.start_at <= now <= item.end_at), None)
        upcoming = next((item for item in reservations if item.start_at > now), None)

        def summary(item):
            if not item:
                return None
            return {
                "id": str(item.id),
                "start_at": item.start_at.isoformat(),
                "end_at": item.end_at.isoformat(),
                "reserved_for": item.reserved_for,
            }

        return {"current": summary(current), "upcoming": summary(upcoming)}

    def get_capabilities(self, obj):
        request = self.context.get("request")
        return vehicle_capabilities(obj, getattr(request, "user", None))

    def get_next_actions(self, obj):
        request = self.context.get("request")
        return vehicle_next_actions(obj, getattr(request, "user", None))


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

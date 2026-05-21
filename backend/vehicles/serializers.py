"""Serializers for vehicle APIs."""

from __future__ import annotations

from rest_framework import serializers

from vehicles.models import Vehicle, VehicleCategory, is_valid_status_transition


class VehicleCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleCategory
        fields = ["id", "name", "description", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = [
            "id",
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
            "archived_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "archived_at", "created_at", "updated_at"]

    def validate(self, attrs):
        if self.instance is not None:
            new_status = attrs.get("status", self.instance.status)
            if not is_valid_status_transition(self.instance.status, new_status):
                raise serializers.ValidationError(
                    {"status": f"Invalid vehicle status transition from {self.instance.status} to {new_status}."}
                )
            new_odometer = attrs.get("current_odometer_km", self.instance.current_odometer_km)
            if (
                self.instance.current_odometer_km is not None
                and new_odometer is not None
                and new_odometer < self.instance.current_odometer_km
            ):
                raise serializers.ValidationError({"current_odometer_km": "Odometer value must not decrease."})
            new_hours = attrs.get("current_operating_hours", self.instance.current_operating_hours)
            if (
                self.instance.current_operating_hours is not None
                and new_hours is not None
                and new_hours < self.instance.current_operating_hours
            ):
                raise serializers.ValidationError({"current_operating_hours": "Operating hours must not decrease."})
        return attrs

"""Serializers for driver APIs."""

from rest_framework import serializers

from drivers.models import Driver


class DriverSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="__str__", read_only=True)

    class Meta:
        model = Driver
        fields = [
            "id",
            "company",
            "first_name",
            "last_name",
            "full_name",
            "phone",
            "email",
            "license_classes",
            "notes",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "full_name", "created_at", "updated_at"]

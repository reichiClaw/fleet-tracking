"""Serializers for driver APIs."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from accounts.permissions import is_admin
from drivers.models import Driver


class DriverSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="__str__", read_only=True)

    def validate_is_active(self, value):
        request = self.context.get("request")
        actor_is_admin = bool(request and is_admin(request.user))
        current = self.instance.is_active if self.instance else True
        if value != current and not actor_is_admin:
            raise serializers.ValidationError(_("Only administrators may change active status."))
        if self.instance and current and not value:
            raise serializers.ValidationError(_("Use the dedicated deactivate action."))
        return value

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

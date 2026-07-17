"""Serializers for company APIs."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from accounts.permissions import is_admin
from parties.models import Company


class CompanySerializer(serializers.ModelSerializer):
    driver_count = serializers.IntegerField(read_only=True, default=0)

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
        model = Company
        fields = [
            "id",
            "name",
            "company_type",
            "contact_name",
            "phone",
            "email",
            "address",
            "notes",
            "is_active",
            "driver_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

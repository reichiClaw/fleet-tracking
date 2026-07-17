"""Serializers for damage report APIs."""

from rest_framework import serializers
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from damages.models import DamageReport


class DamageReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = DamageReport
        fields = [
            "id",
            "vehicle",
            "loan",
            "check_in_protocol",
            "manufacturer_checkout_protocol",
            "description",
            "severity",
            "workflow_phase",
            "discovered_at",
            "resolved_at",
            "resolved_by",
            "resolution_notes",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "loan",
            "check_in_protocol",
            "manufacturer_checkout_protocol",
            "workflow_phase",
            "resolved_at",
            "resolved_by",
            "resolution_notes",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        forbidden = {
            "loan",
            "check_in_protocol",
            "manufacturer_checkout_protocol",
            "workflow_phase",
            "resolved_at",
            "resolved_by",
            "resolution_notes",
        }.intersection(self.initial_data)
        if forbidden:
            raise serializers.ValidationError(
                {field: _("This field is managed by its workflow endpoint.") for field in forbidden}
            )
        return attrs

    def validate_discovered_at(self, value):
        if value > timezone.now():
            raise serializers.ValidationError(_("Damage discovery time cannot be in the future."))
        return value


class DamageResolutionSerializer(serializers.Serializer):
    resolution_notes = serializers.CharField(required=False, allow_blank=True)

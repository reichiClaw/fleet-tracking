"""Serializers for damage report APIs."""

from rest_framework import serializers

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
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

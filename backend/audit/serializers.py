"""Serializers for audit log APIs."""

from rest_framework import serializers

from audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_label = serializers.CharField(source="actor.display_name", read_only=True, default="")

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_label",
            "action",
            "entity_type",
            "entity_id",
            "before",
            "after",
            "ip_address",
            "user_agent",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

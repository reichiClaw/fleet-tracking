"""Serializers for media metadata APIs."""

from rest_framework import serializers

from mediafiles.models import MediaFile


class MediaFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = MediaFile
        fields = [
            "id",
            "vehicle",
            "loan",
            "damage_report",
            "related_type",
            "related_id",
            "media_type",
            "original_filename",
            "storage_key",
            "content_type",
            "size_bytes",
            "uploaded_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uploaded_by", "created_at", "updated_at"]

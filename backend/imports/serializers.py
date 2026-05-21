"""Serializers for import job APIs."""

from rest_framework import serializers

from imports.models import ImportJob


class ImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportJob
        fields = [
            "id",
            "import_type",
            "source_media",
            "status",
            "row_count",
            "error_count",
            "result",
            "created_by",
            "committed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "row_count",
            "error_count",
            "result",
            "created_by",
            "committed_at",
            "created_at",
            "updated_at",
        ]

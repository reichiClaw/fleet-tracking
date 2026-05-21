"""Serializers for media metadata APIs."""

from rest_framework import serializers
from rest_framework.reverse import reverse

from mediafiles.models import MediaFile
from mediafiles.services import create_media_file_from_upload


class MediaFileSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

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
            "language",
            "uploaded_by",
            "download_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "original_filename",
            "storage_key",
            "content_type",
            "size_bytes",
            "language",
            "uploaded_by",
            "download_url",
            "created_at",
            "updated_at",
        ]

    def get_download_url(self, obj):
        request = self.context.get("request")
        return reverse("media-file-download", kwargs={"pk": obj.pk}, request=request)


class MediaFileUploadSerializer(MediaFileSerializer):
    file = serializers.FileField(write_only=True)

    class Meta(MediaFileSerializer.Meta):
        fields = MediaFileSerializer.Meta.fields + ["file"]
        read_only_fields = MediaFileSerializer.Meta.read_only_fields

    def create(self, validated_data):
        uploaded_file = validated_data.pop("file")
        request = self.context["request"]
        return create_media_file_from_upload(
            uploaded_file=uploaded_file,
            actor=request.user,
            media_type=validated_data.pop("media_type"),
            vehicle=validated_data.pop("vehicle", None),
            loan=validated_data.pop("loan", None),
            damage_report=validated_data.pop("damage_report", None),
            related_type=validated_data.pop("related_type", ""),
            related_id=validated_data.pop("related_id", None),
            language=validated_data.pop("language", ""),
        )

"""Serializers for media metadata APIs."""

from rest_framework import serializers
from rest_framework.reverse import reverse
from django.utils.translation import gettext_lazy as _

from config.request import request_metadata
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import create_media_file_from_upload


class MediaFileSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = MediaFile
        # Note: the internal ``storage_key`` is intentionally not exposed by the
        # API. Clients use ``download_url`` to fetch content; leaking the raw
        # storage path is unnecessary and reveals internal layout.
        fields = [
            "id",
            "vehicle",
            "loan",
            "damage_report",
            "related_type",
            "related_id",
            "media_type",
            "original_filename",
            "content_type",
            "size_bytes",
            "content_sha256",
            "language",
            "is_generated",
            "attached_at",
            "uploaded_by",
            "download_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "original_filename",
            "vehicle",
            "loan",
            "damage_report",
            "related_type",
            "related_id",
            "media_type",
            "content_type",
            "size_bytes",
            "content_sha256",
            "language",
            "is_generated",
            "attached_at",
            "uploaded_by",
            "download_url",
            "created_at",
            "updated_at",
        ]

    def get_download_url(self, obj):
        request = self.context.get("request")
        return reverse("media-file-download", kwargs={"pk": obj.pk}, request=request)


class GeneratedDocumentSerializer(MediaFileSerializer):
    """Document listing for the Reports screen: adds a human vehicle label."""

    vehicle_label = serializers.SerializerMethodField()

    class Meta(MediaFileSerializer.Meta):
        fields = MediaFileSerializer.Meta.fields + ["vehicle_label"]

    def get_vehicle_label(self, obj):
        vehicle = obj.vehicle
        if vehicle is None:
            return ""
        return " · ".join(part for part in (vehicle.internal_number, vehicle.manufacturer, vehicle.model) if part)


class MediaFileUploadSerializer(MediaFileSerializer):
    file = serializers.FileField(write_only=True)
    media_type = serializers.ChoiceField(choices=[MediaType.PHOTO, MediaType.SIGNATURE])

    class Meta(MediaFileSerializer.Meta):
        fields = MediaFileSerializer.Meta.fields + ["file"]
        read_only_fields = MediaFileSerializer.Meta.read_only_fields

    def validate(self, attrs):
        supplied_relations = {
            "vehicle",
            "loan",
            "damage_report",
            "related_type",
            "related_id",
            "language",
        }.intersection(self.initial_data)
        if supplied_relations:
            raise serializers.ValidationError(
                {
                    field: _("Uploads must be staged and attached through a workflow.")
                    for field in supplied_relations
                }
            )
        return attrs

    def create(self, validated_data):
        uploaded_file = validated_data.pop("file")
        request = self.context["request"]
        return create_media_file_from_upload(
            uploaded_file=uploaded_file,
            actor=request.user,
            media_type=validated_data.pop("media_type"),
            request_meta=request_metadata(request),
        )

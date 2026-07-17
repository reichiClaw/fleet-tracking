"""Django admin registration for media metadata."""

from django.contrib import admin

from audit.admin_mixins import ImmutableAdminMixin
from mediafiles.models import MediaFile


@admin.register(MediaFile)
class MediaFileAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = (
        "original_filename",
        "media_type",
        "content_type",
        "size_bytes",
        "language",
        "vehicle",
        "loan",
        "damage_report",
        "uploaded_by",
        "created_at",
    )
    list_filter = ("media_type", "content_type", "language", "created_at")
    search_fields = ("original_filename", "storage_key", "vehicle__internal_number", "uploaded_by__username")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("vehicle", "loan", "damage_report", "uploaded_by")
    date_hierarchy = "created_at"

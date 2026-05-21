"""Django admin registration for media metadata."""

from django.contrib import admin

from mediafiles.models import MediaFile


@admin.register(MediaFile)
class MediaFileAdmin(admin.ModelAdmin):
    list_display = ("original_filename", "media_type", "content_type", "size_bytes", "uploaded_by", "created_at")
    list_filter = ("media_type", "content_type", "created_at")
    search_fields = ("original_filename", "storage_key")

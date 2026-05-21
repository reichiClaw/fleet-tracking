"""Django admin registration for import jobs."""

from django.contrib import admin

from imports.models import ImportJob


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ("import_type", "status", "row_count", "error_count", "created_by", "created_at", "committed_at")
    list_filter = ("import_type", "status", "created_at")
    search_fields = ("source_media__original_filename",)

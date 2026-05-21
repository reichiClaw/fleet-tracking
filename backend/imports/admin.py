"""Django admin registration for import jobs."""

from django.contrib import admin

from imports.models import ImportJob


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = (
        "import_type",
        "status",
        "source_media",
        "row_count",
        "error_count",
        "created_by",
        "created_at",
        "committed_at",
    )
    list_filter = ("import_type", "status", "created_at", "committed_at")
    search_fields = ("source_media__original_filename", "created_by__username", "created_by__email")
    readonly_fields = (
        "id",
        "source_media",
        "status",
        "row_count",
        "error_count",
        "result",
        "created_by",
        "committed_at",
        "created_at",
        "updated_at",
    )
    list_select_related = ("source_media", "created_by")
    date_hierarchy = "created_at"

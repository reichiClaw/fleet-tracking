"""Django admin registration for damage reports."""

from django.contrib import admin

from damages.models import DamageReport


@admin.register(DamageReport)
class DamageReportAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "severity", "workflow_phase", "loan", "discovered_at", "resolved_at", "created_by")
    list_filter = ("severity", "workflow_phase", "discovered_at", "resolved_at")
    search_fields = ("vehicle__internal_number", "description", "created_by__username")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("vehicle", "loan", "created_by")
    date_hierarchy = "discovered_at"

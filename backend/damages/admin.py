"""Django admin registration for damage reports."""

from django.contrib import admin

from damages.models import DamageReport


@admin.register(DamageReport)
class DamageReportAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "severity", "discovered_at", "resolved_at", "created_by")
    list_filter = ("severity", "discovered_at", "resolved_at")
    search_fields = ("vehicle__internal_number", "description")

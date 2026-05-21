"""Django admin registration for drivers."""

from django.contrib import admin

from drivers.models import Driver


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ("last_name", "first_name", "company", "phone", "email", "license_classes", "is_active")
    list_filter = ("is_active", "company", "created_at")
    search_fields = ("first_name", "last_name", "phone", "email", "license_classes", "company__name")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("company",)

"""Django admin registration for vehicle master data."""

from django.contrib import admin

from audit.admin_mixins import AuditedAdminMixin
from vehicles.models import Vehicle, VehicleCategory


@admin.register(VehicleCategory)
class VehicleCategoryAdmin(AuditedAdminMixin, admin.ModelAdmin):
    audit_entity_type = "vehicle_category"
    list_display = ("name", "meter_mode", "is_active", "created_at", "updated_at")
    list_filter = ("meter_mode", "is_active", "created_at")
    search_fields = ("name", "description")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Vehicle)
class VehicleAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = (
        "internal_number",
        "category",
        "manufacturer",
        "model",
        "serial_number",
        "license_plate",
        "status",
        "current_odometer_km",
        "current_operating_hours",
        "current_location",
        "archived_at",
        "archived_by",
    )
    list_filter = ("status", "category", "manufacturer", "archived_at", "created_at")
    search_fields = ("internal_number", "manufacturer", "model", "serial_number", "license_plate", "current_location")
    readonly_fields = ("id", "created_at", "updated_at", "archived_at", "archived_by")
    list_select_related = ("category", "archived_by")
    date_hierarchy = "created_at"

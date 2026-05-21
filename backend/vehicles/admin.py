"""Django admin registration for vehicle master data."""

from django.contrib import admin

from vehicles.models import Vehicle, VehicleCategory


@admin.register(VehicleCategory)
class VehicleCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "created_at", "updated_at")
    list_filter = ("is_active", "created_at")
    search_fields = ("name", "description")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
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
    )
    list_filter = ("status", "category", "manufacturer", "archived_at", "created_at")
    search_fields = ("internal_number", "manufacturer", "model", "serial_number", "license_plate", "current_location")
    readonly_fields = ("id", "created_at", "updated_at", "archived_at")
    list_select_related = ("category",)
    date_hierarchy = "created_at"

"""Django admin registration for vehicle master data."""

from django.contrib import admin

from vehicles.models import Vehicle, VehicleCategory


@admin.register(VehicleCategory)
class VehicleCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "created_at", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "description")


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("internal_number", "category", "manufacturer", "model", "status", "current_location", "archived_at")
    list_filter = ("status", "category", "manufacturer")
    search_fields = ("internal_number", "manufacturer", "model", "serial_number", "license_plate")
    readonly_fields = ("created_at", "updated_at")

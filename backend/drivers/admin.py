"""Django admin registration for drivers."""

from django.contrib import admin

from drivers.models import Driver


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ("last_name", "first_name", "company", "phone", "is_active")
    list_filter = ("is_active", "company")
    search_fields = ("first_name", "last_name", "phone", "email")

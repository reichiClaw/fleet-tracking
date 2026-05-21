"""Django admin registration for companies."""

from django.contrib import admin

from parties.models import Company


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "company_type", "contact_name", "phone", "email", "is_active")
    list_filter = ("company_type", "is_active", "created_at")
    search_fields = ("name", "contact_name", "email", "phone", "address", "notes")
    readonly_fields = ("id", "created_at", "updated_at")

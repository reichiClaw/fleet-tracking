"""Django admin registration for companies."""

from django.contrib import admin

from parties.models import Company


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "company_type", "contact_name", "is_active")
    list_filter = ("company_type", "is_active")
    search_fields = ("name", "contact_name", "email", "phone")

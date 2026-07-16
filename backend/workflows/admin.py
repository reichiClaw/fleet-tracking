"""Django admin registration for workflow records."""

from django.contrib import admin

from audit.admin_mixins import ImmutableAdminMixin
from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol


@admin.register(Loan)
class LoanAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = (
        "vehicle",
        "company",
        "driver",
        "borrower_name",
        "status",
        "expected_return_at",
        "actual_return_at",
        "created_by",
    )
    list_filter = ("status", "expected_return_at", "actual_return_at", "company")
    search_fields = ("vehicle__internal_number", "borrower_name", "borrower_phone", "company__name", "driver__last_name")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("vehicle", "company", "driver", "created_by", "returned_by")
    date_hierarchy = "expected_return_at"


@admin.register(CheckInProtocol)
class CheckInProtocolAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = ("vehicle", "performed_by", "performed_at", "supplier_company", "odometer_km", "operating_hours")
    list_filter = ("performed_at", "supplier_company")
    search_fields = ("vehicle__internal_number", "condition_notes", "supplier_company__name", "performed_by__username")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("vehicle", "performed_by", "supplier_company")
    date_hierarchy = "performed_at"


@admin.register(ManufacturerCheckOutProtocol)
class ManufacturerCheckOutProtocolAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = ("vehicle", "performed_by", "performed_at", "recipient_company", "odometer_km", "operating_hours")
    list_filter = ("performed_at", "recipient_company")
    search_fields = ("vehicle__internal_number", "condition_notes", "recipient_company__name", "performed_by__username")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("vehicle", "performed_by", "recipient_company")
    date_hierarchy = "performed_at"

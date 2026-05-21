"""Django admin registration for workflow records."""

from django.contrib import admin

from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "borrower_name", "driver", "status", "expected_return_at", "actual_return_at")
    list_filter = ("status", "expected_return_at")
    search_fields = ("vehicle__internal_number", "borrower_name", "borrower_phone")


@admin.register(CheckInProtocol)
class CheckInProtocolAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "performed_by", "performed_at", "supplier_company")
    list_filter = ("performed_at",)
    search_fields = ("vehicle__internal_number", "condition_notes")


@admin.register(ManufacturerCheckOutProtocol)
class ManufacturerCheckOutProtocolAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "performed_by", "performed_at", "recipient_company")
    list_filter = ("performed_at",)
    search_fields = ("vehicle__internal_number", "condition_notes")

"""Django admin registration for workflow records."""

from django.contrib import admin

from audit.admin_mixins import ImmutableAdminMixin
from workflows.models import (
    CheckInProtocol,
    Loan,
    MaintenanceRecord,
    ManufacturerCheckOutProtocol,
    Reservation,
    WorkflowDraft,
)


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


@admin.register(Reservation)
class ReservationAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = ("vehicle", "reserved_for", "start_at", "end_at", "status", "loan", "created_by")
    list_filter = ("status", "start_at", "end_at")
    search_fields = ("vehicle__internal_number", "reserved_for", "manual_phone", "company__name")
    list_select_related = ("vehicle", "driver", "company", "loan", "created_by")


@admin.register(MaintenanceRecord)
class MaintenanceRecordAdmin(ImmutableAdminMixin, admin.ModelAdmin):
    list_display = ("vehicle", "reason", "started_at", "completed_at", "status", "started_by")
    list_filter = ("status", "started_at", "completed_at")
    search_fields = ("vehicle__internal_number", "reason", "start_notes", "completion_notes")
    list_select_related = ("vehicle", "started_by", "completed_by")


@admin.register(WorkflowDraft)
class WorkflowDraftAdmin(admin.ModelAdmin):
    list_display = ("owner", "workflow_type", "scope_key", "step", "version", "expires_at", "updated_at")
    list_filter = ("workflow_type", "expires_at")
    search_fields = ("owner__username", "scope_key")
    readonly_fields = ("id", "owner", "form_data", "staged_media_ids", "version", "created_at", "updated_at")
    list_select_related = ("owner",)

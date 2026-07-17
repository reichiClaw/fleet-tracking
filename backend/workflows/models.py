"""Operational workflow records."""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class LoanStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    RETURNED = "returned", _("Returned")
    CANCELLED = "cancelled", _("Cancelled")


class ConditionOutcome(models.TextChoices):
    FIT = "fit", _("Fit for service")
    NEW_DAMAGE = "new_damage", _("New damage")
    MAINTENANCE = "maintenance", _("Maintenance required")


class Loan(TimeStampedUUIDModel):
    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="loans")
    company = models.ForeignKey("parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="loans")
    driver = models.ForeignKey("drivers.Driver", on_delete=models.SET_NULL, null=True, blank=True, related_name="loans")
    borrower_name = models.CharField(max_length=255, blank=True)
    borrower_phone = models.CharField(max_length=80, blank=True)
    expected_return_at = models.DateTimeField()
    actual_return_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=LoanStatus.choices, default=LoanStatus.ACTIVE)
    checkout_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    checkout_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    return_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    return_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    checkout_notes = models.TextField(blank=True)
    return_notes = models.TextField(blank=True)
    return_condition_outcome = models.CharField(
        max_length=20,
        choices=ConditionOutcome.choices,
        blank=True,
    )
    checkout_pdf_media = models.ForeignKey(
        "mediafiles.MediaFile", on_delete=models.PROTECT, null=True, blank=True, related_name="loan_checkout_documents"
    )
    return_pdf_media = models.ForeignKey(
        "mediafiles.MediaFile", on_delete=models.PROTECT, null=True, blank=True, related_name="loan_return_documents"
    )
    checkout_pdf_language = models.CharField(max_length=10, blank=True)
    return_pdf_language = models.CharField(max_length=10, blank=True)
    checkout_snapshot = models.JSONField(default=dict, blank=True)
    return_snapshot = models.JSONField(default=dict, blank=True)
    checkout_pdf_generation_error = models.TextField(blank=True)
    return_pdf_generation_error = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_loans")
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="returned_loans"
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(status="active"),
                name="unique_active_loan_per_vehicle",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "expected_return_at"], name="loan_status_expected_idx"),
            models.Index(fields=["vehicle", "-created_at"], name="loan_vehicle_created_idx"),
        ]

    def __str__(self) -> str:
        return f"Loan {self.vehicle_id} ({self.status})"

    def clean(self):
        errors: dict[str, list[str]] = {}
        if not self.driver_id and not self.borrower_name:
            errors.setdefault("borrower_name", []).append(_("Borrower name is required when no driver is selected."))
        if self.checkout_operating_hours is not None and self.checkout_operating_hours < Decimal("0"):
            errors.setdefault("checkout_operating_hours", []).append(_("Operating hours must be non-negative."))
        if self.return_operating_hours is not None and self.return_operating_hours < Decimal("0"):
            errors.setdefault("return_operating_hours", []).append(_("Operating hours must be non-negative."))
        if (
            self.checkout_odometer_km is not None
            and self.return_odometer_km is not None
            and self.return_odometer_km < self.checkout_odometer_km
        ):
            errors.setdefault("return_odometer_km", []).append(_("Return odometer must not be lower than checkout odometer."))
        if (
            self.checkout_operating_hours is not None
            and self.return_operating_hours is not None
            and self.return_operating_hours < self.checkout_operating_hours
        ):
            errors.setdefault("return_operating_hours", []).append(
                _("Return operating hours must not be lower than checkout operating hours.")
            )
        if self.status == LoanStatus.RETURNED and self.actual_return_at is None:
            self.actual_return_at = timezone.now()
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            _validate_write_once(previous, self, "checkout_snapshot")
            _validate_write_once(previous, self, "return_snapshot")
            _validate_write_once(previous, self, "checkout_pdf_media_id")
            _validate_write_once(previous, self, "return_pdf_media_id")
            _validate_write_once(previous, self, "checkout_pdf_language")
            _validate_write_once(previous, self, "return_pdf_language")
            _validate_write_once(previous, self, "return_condition_outcome")
        self.full_clean()
        return super().save(*args, **kwargs)


class ReservationStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    CANCELLED = "cancelled", _("Cancelled")
    FULFILLED = "fulfilled", _("Fulfilled")
    NO_SHOW = "no_show", _("No-show")


class Reservation(TimeStampedUUIDModel):
    """A time-bounded booking of a vehicle (separate from its current status)."""

    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="reservations")
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    driver = models.ForeignKey("drivers.Driver", on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations")
    company = models.ForeignKey("parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations")
    reserved_for = models.CharField(max_length=255, blank=True)
    manual_phone = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=ReservationStatus.choices, default=ReservationStatus.ACTIVE)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_reservations")
    snapshot = models.JSONField(default=dict, blank=True)
    fulfilled_at = models.DateTimeField(null=True, blank=True)
    fulfilled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fulfilled_reservations",
    )
    loan = models.OneToOneField(
        Loan,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reservation",
    )

    class Meta:
        ordering = ["start_at"]
        indexes = [
            models.Index(fields=["vehicle", "status", "start_at", "end_at"], name="reservation_overlap_idx"),
            models.Index(fields=["status", "start_at"], name="reservation_status_idx"),
            models.Index(fields=["status", "end_at"], name="reservation_status_end_idx"),
        ]

    def __str__(self) -> str:
        return f"Reservation {self.vehicle_id} ({self.start_at:%Y-%m-%d} - {self.end_at:%Y-%m-%d})"

    def clean(self):
        errors = {}
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            errors["end_at"] = _("Reservation end must be after its start.")
        if self.status == ReservationStatus.FULFILLED and not all(
            (self.fulfilled_at, self.fulfilled_by_id, self.loan_id)
        ):
            errors["status"] = _("A fulfilled reservation requires its timestamp, user, and loan.")
        if self.status != ReservationStatus.FULFILLED and any(
            (self.fulfilled_at, self.fulfilled_by_id, self.loan_id)
        ):
            errors["status"] = _("Only fulfilled reservations may link a loan.")
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            _validate_write_once(previous, self, "snapshot")
            if previous.status != ReservationStatus.ACTIVE and any(
                getattr(previous, field) != getattr(self, field)
                for field in ("vehicle_id", "start_at", "end_at", "driver_id", "company_id", "reserved_for", "manual_phone")
            ):
                raise ValidationError(_("Completed or cancelled reservations are immutable."))
            if previous.fulfilled_at and any(
                getattr(previous, field) != getattr(self, field)
                for field in ("fulfilled_at", "fulfilled_by_id", "loan_id")
            ):
                raise ValidationError(_("Reservation fulfillment is immutable."))
        self.full_clean()
        return super().save(*args, **kwargs)


class CheckInProtocol(TimeStampedUUIDModel):
    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="check_in_protocols")
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="check_in_protocols")
    performed_at = models.DateTimeField(default=timezone.now)
    supplier_company = models.ForeignKey(
        "parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="check_in_protocols"
    )
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    condition_notes = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict, blank=True)
    idempotency_key = models.CharField(max_length=128, null=True, blank=True, unique=True)
    request_fingerprint = models.CharField(max_length=64, blank=True)
    pdf_media = models.ForeignKey("mediafiles.MediaFile", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    pdf_language = models.CharField(max_length=10, blank=True)
    pdf_generation_error = models.TextField(blank=True)

    class Meta:
        ordering = ["-performed_at"]
        indexes = [models.Index(fields=["vehicle", "-performed_at"], name="checkin_vehicle_time_idx")]

    def __str__(self) -> str:
        return f"Check-in {self.vehicle_id} at {self.performed_at:%Y-%m-%d}"

    def clean(self):
        if self.operating_hours is not None and self.operating_hours < Decimal("0"):
            raise ValidationError({"operating_hours": _("Operating hours must be non-negative.")})

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            _validate_write_once(previous, self, "snapshot")
            _validate_write_once(previous, self, "pdf_media_id")
            _validate_write_once(previous, self, "pdf_language")
        self.full_clean()
        return super().save(*args, **kwargs)


class ManufacturerCheckOutProtocol(TimeStampedUUIDModel):
    vehicle = models.ForeignKey(
        "vehicles.Vehicle", on_delete=models.PROTECT, related_name="manufacturer_checkout_protocols"
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="manufacturer_checkout_protocols"
    )
    performed_at = models.DateTimeField(default=timezone.now)
    recipient_company = models.ForeignKey(
        "parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="manufacturer_checkout_protocols"
    )
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    condition_notes = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict, blank=True)
    pdf_media = models.ForeignKey("mediafiles.MediaFile", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    pdf_language = models.CharField(max_length=10, blank=True)
    pdf_generation_error = models.TextField(blank=True)

    class Meta:
        ordering = ["-performed_at"]
        indexes = [
            models.Index(fields=["vehicle", "-performed_at"], name="manufacturer_time_idx"),
        ]

    def __str__(self) -> str:
        return f"Manufacturer checkout {self.vehicle_id} at {self.performed_at:%Y-%m-%d}"

    def clean(self):
        if self.operating_hours is not None and self.operating_hours < Decimal("0"):
            raise ValidationError({"operating_hours": _("Operating hours must be non-negative.")})

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            _validate_write_once(previous, self, "snapshot")
            _validate_write_once(previous, self, "pdf_media_id")
            _validate_write_once(previous, self, "pdf_language")
        self.full_clean()
        return super().save(*args, **kwargs)


class MaintenanceStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    COMPLETED = "completed", _("Completed")


class MaintenanceRecord(TimeStampedUUIDModel):
    """Auditable maintenance interval and immutable start/completion evidence."""

    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="maintenance_records")
    reason = models.TextField()
    start_notes = models.TextField(blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="started_maintenance_records",
    )
    start_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    start_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    start_snapshot = models.JSONField(default=dict, blank=True)
    completion_notes = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="completed_maintenance_records",
    )
    completion_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    completion_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    completion_snapshot = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=MaintenanceStatus.choices, default=MaintenanceStatus.ACTIVE)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(status="active"),
                name="unique_active_maintenance_per_vehicle",
            ),
        ]
        indexes = [
            models.Index(fields=["vehicle", "-started_at"], name="maintenance_vehicle_time_idx"),
            models.Index(fields=["status", "-started_at"], name="maintenance_status_time_idx"),
        ]

    def clean(self):
        errors = {}
        if not self.reason.strip():
            errors["reason"] = _("A maintenance reason is required.")
        if self.status == MaintenanceStatus.COMPLETED and not all((self.completed_at, self.completed_by_id)):
            errors["status"] = _("Completed maintenance requires a timestamp and user.")
        if self.status == MaintenanceStatus.ACTIVE and any((self.completed_at, self.completed_by_id)):
            errors["status"] = _("Active maintenance cannot contain completion metadata.")
        if self.completed_at and self.completed_at < self.started_at:
            errors["completed_at"] = _("Maintenance completion cannot be earlier than its start.")
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            _validate_write_once(previous, self, "start_snapshot")
            _validate_write_once(previous, self, "completion_snapshot")
            for field in ("vehicle_id", "reason", "start_notes", "started_at", "started_by_id"):
                if getattr(previous, field) != getattr(self, field):
                    raise ValidationError(_("Maintenance start evidence is immutable."))
            if previous.status == MaintenanceStatus.COMPLETED and any(
                getattr(previous, field) != getattr(self, field)
                for field in (
                    "status",
                    "completion_notes",
                    "completed_at",
                    "completed_by_id",
                    "completion_odometer_km",
                    "completion_operating_hours",
                )
            ):
                raise ValidationError(_("Maintenance completion evidence is immutable."))
        self.full_clean()
        return super().save(*args, **kwargs)


class WorkflowDraft(TimeStampedUUIDModel):
    class WorkflowType(models.TextChoices):
        CHECK_IN = "check_in", _("Check-in")
        LOAN_CHECKOUT = "loan_checkout", _("Loan checkout")
        LOAN_RETURN = "loan_return", _("Loan return")
        MANUFACTURER_RETURN = "manufacturer_return", _("Manufacturer return")
        RESERVATION = "reservation", _("Reservation")
        MAINTENANCE = "maintenance", _("Maintenance")

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workflow_drafts")
    workflow_type = models.CharField(max_length=40, choices=WorkflowType.choices)
    scope_key = models.CharField(max_length=160, blank=True)
    object_id = models.UUIDField(null=True, blank=True)
    form_data = models.JSONField(default=dict, blank=True)
    staged_media_ids = models.JSONField(default=list, blank=True)
    step = models.PositiveIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "workflow_type", "scope_key"],
                name="unique_workflow_draft_scope",
            )
        ]
        indexes = [
            models.Index(fields=["owner", "-updated_at"], name="draft_owner_updated_idx"),
            models.Index(fields=["expires_at"], name="draft_expiry_idx"),
        ]

    def clean(self):
        if self.expires_at <= timezone.now():
            raise ValidationError({"expires_at": _("Draft expiry must be in the future.")})
        if not isinstance(self.form_data, dict):
            raise ValidationError({"form_data": _("Draft form data must be an object.")})
        if not isinstance(self.staged_media_ids, list):
            raise ValidationError({"staged_media_ids": _("Draft media IDs must be a list.")})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


def _validate_write_once(previous, current, field: str) -> None:
    old = getattr(previous, field)
    new = getattr(current, field)
    if old and old != new:
        raise ValidationError({field: _("Completed workflow data is immutable.")})

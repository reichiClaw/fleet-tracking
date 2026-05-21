"""Operational workflow records."""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class LoanStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    RETURNED = "returned", _("Returned")
    CANCELLED = "cancelled", _("Cancelled")


class Loan(TimeStampedUUIDModel):
    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="loans")
    company = models.ForeignKey("parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="loans")
    driver = models.ForeignKey("drivers.Driver", on_delete=models.SET_NULL, null=True, blank=True, related_name="loans")
    borrower_name = models.CharField(max_length=255, blank=True)
    borrower_phone = models.CharField(max_length=80)
    expected_return_at = models.DateTimeField()
    actual_return_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=LoanStatus.choices, default=LoanStatus.ACTIVE)
    checkout_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    checkout_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    return_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    return_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    checkout_notes = models.TextField(blank=True)
    return_notes = models.TextField(blank=True)
    checkout_pdf_language = models.CharField(max_length=10, blank=True)
    return_pdf_language = models.CharField(max_length=10, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_loans")
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="returned_loans"
    )

    class Meta:
        ordering = ["-created_at"]

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
    pdf_media = models.ForeignKey("mediafiles.MediaFile", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    pdf_language = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["-performed_at"]

    def __str__(self) -> str:
        return f"Check-in {self.vehicle_id} at {self.performed_at:%Y-%m-%d}"

    def clean(self):
        if self.operating_hours is not None and self.operating_hours < Decimal("0"):
            raise ValidationError({"operating_hours": _("Operating hours must be non-negative.")})

    def save(self, *args, **kwargs):
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
    pdf_media = models.ForeignKey("mediafiles.MediaFile", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    pdf_language = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["-performed_at"]

    def __str__(self) -> str:
        return f"Manufacturer checkout {self.vehicle_id} at {self.performed_at:%Y-%m-%d}"

    def clean(self):
        if self.operating_hours is not None and self.operating_hours < Decimal("0"):
            raise ValidationError({"operating_hours": _("Operating hours must be non-negative.")})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

"""Vehicle master data models and status invariants."""

from __future__ import annotations

import secrets
import string
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel

QR_CODE_ALPHABET = "".join(ch for ch in string.ascii_uppercase + string.digits if ch not in {"0", "O", "1", "I"})


def generate_vehicle_qr_code() -> str:
    """Generate a stable, human-readable vehicle QR code that is not a database ID."""
    return "VH-" + "".join(secrets.choice(QR_CODE_ALPHABET) for _ in range(10))


INTERNAL_NUMBER_PREFIX = "FZ-"


def generate_internal_number() -> str:
    """Return the next sequential internal fleet number, e.g. FZ-00001."""
    highest = 0
    existing = Vehicle.objects.filter(internal_number__startswith=INTERNAL_NUMBER_PREFIX).values_list(
        "internal_number", flat=True
    )
    for number in existing:
        suffix = number[len(INTERNAL_NUMBER_PREFIX) :]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{INTERNAL_NUMBER_PREFIX}{highest + 1:05d}"


class VehicleStatus(models.TextChoices):
    ANNOUNCED = "announced", _("Announced")
    CHECKED_IN = "checked_in", _("Checked in")
    AVAILABLE = "available", _("Available")
    RESERVED = "reserved", _("Reserved")
    LOANED = "loaned", _("Loaned")
    MAINTENANCE = "maintenance", _("Maintenance")
    DAMAGED = "damaged", _("Damaged")
    MANUFACTURER_CHECKOUT = "manufacturer_checkout", _("Manufacturer checkout")
    ARCHIVED = "archived", _("Archived")


ALLOWED_STATUS_TRANSITIONS = {
    VehicleStatus.ANNOUNCED: {VehicleStatus.CHECKED_IN},
    VehicleStatus.CHECKED_IN: {VehicleStatus.AVAILABLE},
    VehicleStatus.AVAILABLE: {
        VehicleStatus.LOANED,
        VehicleStatus.MAINTENANCE,
        VehicleStatus.DAMAGED,
        VehicleStatus.MANUFACTURER_CHECKOUT,
    },
    VehicleStatus.LOANED: {VehicleStatus.AVAILABLE},
    VehicleStatus.MAINTENANCE: {VehicleStatus.AVAILABLE},
    VehicleStatus.DAMAGED: {VehicleStatus.MAINTENANCE, VehicleStatus.AVAILABLE},
    VehicleStatus.MANUFACTURER_CHECKOUT: {VehicleStatus.ARCHIVED},
    VehicleStatus.RESERVED: {VehicleStatus.AVAILABLE, VehicleStatus.LOANED},
    VehicleStatus.ARCHIVED: set(),
}


def is_valid_status_transition(old_status: str, new_status: str) -> bool:
    if old_status == new_status:
        return True
    return new_status in ALLOWED_STATUS_TRANSITIONS.get(old_status, set())


class VehicleCategory(TimeStampedUUIDModel):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "vehicle categories"

    def __str__(self) -> str:
        return self.name


class Vehicle(TimeStampedUUIDModel):
    internal_number = models.CharField(max_length=80, unique=True, blank=True)
    qr_code = models.CharField(max_length=24, unique=True, default=generate_vehicle_qr_code, editable=False)
    category = models.ForeignKey(VehicleCategory, on_delete=models.PROTECT, related_name="vehicles")
    manufacturer = models.CharField(max_length=120)
    model = models.CharField(max_length=120)
    serial_number = models.CharField(max_length=120, blank=True)
    license_plate = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=40, choices=VehicleStatus.choices, default=VehicleStatus.ANNOUNCED)
    current_odometer_km = models.PositiveIntegerField(null=True, blank=True)
    current_operating_hours = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    current_location = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    # Optional scheduled date by which the vehicle must be removed from the pool
    # and sent back to the manufacturer/supplier.
    manufacturer_return_due = models.DateField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["internal_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["serial_number"],
                condition=~Q(serial_number=""),
                name="unique_vehicle_serial_number_when_present",
            ),
            models.UniqueConstraint(
                fields=["license_plate"],
                condition=~Q(license_plate=""),
                name="unique_vehicle_license_plate_when_present",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.internal_number} - {self.manufacturer} {self.model}"

    def clean(self):
        errors: dict[str, list[str]] = {}
        if self.current_operating_hours is not None and self.current_operating_hours < Decimal("0"):
            errors.setdefault("current_operating_hours", []).append(_("Operating hours must be non-negative."))
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).only(
                "status", "current_odometer_km", "current_operating_hours"
            ).first()
            if previous:
                if not is_valid_status_transition(previous.status, self.status):
                    errors.setdefault("status", []).append(
                        _("Invalid vehicle status transition from %(old)s to %(new)s.")
                        % {"old": previous.status, "new": self.status}
                    )
                if (
                    previous.current_odometer_km is not None
                    and self.current_odometer_km is not None
                    and self.current_odometer_km < previous.current_odometer_km
                ):
                    errors.setdefault("current_odometer_km", []).append(_("Odometer value must not decrease."))
                if (
                    previous.current_operating_hours is not None
                    and self.current_operating_hours is not None
                    and self.current_operating_hours < previous.current_operating_hours
                ):
                    errors.setdefault("current_operating_hours", []).append(_("Operating hours must not decrease."))
        if self.status == VehicleStatus.ARCHIVED and self.archived_at is None:
            self.archived_at = timezone.now()
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if not self.qr_code:
            self.qr_code = generate_vehicle_qr_code()
        if not self.internal_number:
            self.internal_number = generate_internal_number()
        self.full_clean()
        return super().save(*args, **kwargs)

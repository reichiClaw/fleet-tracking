"""Vehicle master data models and status invariants."""

from __future__ import annotations

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


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
    internal_number = models.CharField(max_length=80, unique=True)
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
        self.full_clean()
        return super().save(*args, **kwargs)

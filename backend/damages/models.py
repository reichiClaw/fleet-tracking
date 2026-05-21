"""Damage report records."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class DamageSeverity(models.TextChoices):
    MINOR = "minor", _("Minor")
    MAJOR = "major", _("Major")
    CRITICAL = "critical", _("Critical")
    UNKNOWN = "unknown", _("Unknown")


class DamageReport(TimeStampedUUIDModel):
    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.PROTECT, related_name="damage_reports")
    loan = models.ForeignKey("workflows.Loan", on_delete=models.SET_NULL, null=True, blank=True, related_name="damage_reports")
    check_in_protocol = models.ForeignKey(
        "workflows.CheckInProtocol", on_delete=models.SET_NULL, null=True, blank=True, related_name="damage_reports"
    )
    manufacturer_checkout_protocol = models.ForeignKey(
        "workflows.ManufacturerCheckOutProtocol",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damage_reports",
    )
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=DamageSeverity.choices, default=DamageSeverity.UNKNOWN)
    discovered_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="damage_reports")

    class Meta:
        ordering = ["-discovered_at"]

    def __str__(self) -> str:
        return f"Damage {self.vehicle_id} ({self.severity})"

    def clean(self):
        if not self.description:
            raise ValidationError({"description": _("Damage description is required.")})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

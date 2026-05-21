"""Driver master data."""

from __future__ import annotations

from django.db import models

from config.models import TimeStampedUUIDModel


class Driver(TimeStampedUUIDModel):
    company = models.ForeignKey("parties.Company", on_delete=models.SET_NULL, null=True, blank=True, related_name="drivers")
    first_name = models.CharField(max_length=120)
    last_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True)
    license_classes = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["last_name", "first_name"]

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name}"

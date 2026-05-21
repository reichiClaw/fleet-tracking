"""Company and organization master data."""

from __future__ import annotations

from django.db import models
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class Company(TimeStampedUUIDModel):
    class CompanyType(models.TextChoices):
        SUBCONTRACTOR = "subcontractor", _("Subcontractor")
        MANUFACTURER = "manufacturer", _("Manufacturer")
        SUPPLIER = "supplier", _("Supplier")
        INTERNAL = "internal", _("Internal")

    name = models.CharField(max_length=255)
    company_type = models.CharField(max_length=30, choices=CompanyType.choices)
    contact_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"
        constraints = [models.UniqueConstraint(fields=["name", "company_type"], name="unique_company_name_type")]

    def __str__(self) -> str:
        return self.name

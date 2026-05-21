"""Import job metadata."""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class ImportJob(TimeStampedUUIDModel):
    class ImportType(models.TextChoices):
        VEHICLES = "vehicles", _("Vehicles")
        DRIVERS = "drivers", _("Drivers")
        COMPANIES = "companies", _("Companies")

    class Status(models.TextChoices):
        UPLOADED = "uploaded", _("Uploaded")
        VALIDATED = "validated", _("Validated")
        FAILED = "failed", _("Failed")
        COMMITTED = "committed", _("Committed")

    import_type = models.CharField(max_length=30, choices=ImportType.choices)
    source_media = models.ForeignKey("mediafiles.MediaFile", on_delete=models.PROTECT, related_name="import_jobs")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.UPLOADED)
    row_count = models.PositiveIntegerField(null=True, blank=True)
    error_count = models.PositiveIntegerField(null=True, blank=True)
    result = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="import_jobs")
    committed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.import_type} import ({self.status})"

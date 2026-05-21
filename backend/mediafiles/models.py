"""Media metadata records."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

from config.models import TimeStampedUUIDModel


class MediaType(models.TextChoices):
    PHOTO = "photo", _("Photo")
    SIGNATURE = "signature", _("Signature")
    PDF = "pdf", _("PDF")
    IMPORT = "import", _("Import")


class MediaFile(TimeStampedUUIDModel):
    vehicle = models.ForeignKey("vehicles.Vehicle", on_delete=models.SET_NULL, null=True, blank=True, related_name="media_files")
    loan = models.ForeignKey("workflows.Loan", on_delete=models.SET_NULL, null=True, blank=True, related_name="media_files")
    damage_report = models.ForeignKey(
        "damages.DamageReport", on_delete=models.SET_NULL, null=True, blank=True, related_name="media_files"
    )
    related_type = models.CharField(max_length=80, blank=True)
    related_id = models.UUIDField(null=True, blank=True)
    media_type = models.CharField(max_length=20, choices=MediaType.choices)
    original_filename = models.CharField(max_length=255)
    storage_key = models.CharField(max_length=500, unique=True)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveBigIntegerField()
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="media_files")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.original_filename

    def clean(self):
        if self.size_bytes <= 0:
            raise ValidationError({"size_bytes": _("File size must be greater than zero.")})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

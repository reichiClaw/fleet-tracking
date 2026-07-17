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


class DamageWorkflowPhase(models.TextChoices):
    GENERAL = "general", _("General")
    CHECK_IN = "check_in", _("Check-in")
    LOAN_CHECKOUT = "loan_checkout", _("Loan checkout")
    LOAN_RETURN = "loan_return", _("Loan return")
    MANUFACTURER_CHECKOUT = "manufacturer_checkout", _("Manufacturer check-out")


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
    workflow_phase = models.CharField(
        max_length=40,
        choices=DamageWorkflowPhase.choices,
        default=DamageWorkflowPhase.GENERAL,
    )
    discovered_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="resolved_damage_reports",
    )
    resolution_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="damage_reports")

    class Meta:
        ordering = ["-discovered_at"]
        indexes = [
            models.Index(fields=["vehicle", "resolved_at", "-discovered_at"], name="damage_vehicle_open_idx"),
            models.Index(fields=["workflow_phase", "-discovered_at"], name="damage_phase_time_idx"),
        ]

    def __str__(self) -> str:
        return f"Damage {self.vehicle_id} ({self.severity})"

    def clean(self):
        errors = {}
        if not self.description:
            errors["description"] = _("Damage description is required.")
        links = [self.loan_id, self.check_in_protocol_id, self.manufacturer_checkout_protocol_id]
        if sum(value is not None for value in links) > 1:
            errors["workflow_phase"] = _("A damage report can belong to only one workflow record.")
        if self.loan_id and self.loan.vehicle_id != self.vehicle_id:
            errors["loan"] = _("The loan and damage report must belong to the same vehicle.")
        if self.check_in_protocol_id:
            if self.check_in_protocol.vehicle_id != self.vehicle_id:
                errors["check_in_protocol"] = _("The check-in and damage report must belong to the same vehicle.")
            if self.workflow_phase != DamageWorkflowPhase.CHECK_IN:
                errors["workflow_phase"] = _("The damage workflow phase does not match its check-in.")
        if self.manufacturer_checkout_protocol_id:
            if self.manufacturer_checkout_protocol.vehicle_id != self.vehicle_id:
                errors["manufacturer_checkout_protocol"] = _(
                    "The manufacturer check-out and damage report must belong to the same vehicle."
                )
            if self.workflow_phase != DamageWorkflowPhase.MANUFACTURER_CHECKOUT:
                errors["workflow_phase"] = _("The damage workflow phase does not match its manufacturer check-out.")
        if self.workflow_phase in {DamageWorkflowPhase.LOAN_CHECKOUT, DamageWorkflowPhase.LOAN_RETURN} and not self.loan_id:
            errors["workflow_phase"] = _("A loan workflow damage requires a loan.")
        if self.workflow_phase == DamageWorkflowPhase.GENERAL and any(links):
            errors["workflow_phase"] = _("General damage cannot reference a workflow record.")
        if bool(self.resolved_at) != bool(self.resolved_by_id):
            legacy_resolution = bool(
                self.pk
                and self.resolved_at
                and not self.resolved_by_id
                and type(self).objects.filter(
                    pk=self.pk,
                    resolved_at=self.resolved_at,
                    resolved_by__isnull=True,
                ).exists()
            )
            if not legacy_resolution:
                errors["resolved_at"] = _("Damage resolution requires both a timestamp and resolving user.")
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        previous = type(self).objects.filter(pk=self.pk).first() if self.pk else None
        if previous:
            immutable_fields = (
                "vehicle_id",
                "loan_id",
                "check_in_protocol_id",
                "manufacturer_checkout_protocol_id",
                "workflow_phase",
                "created_by_id",
            )
            if any(getattr(previous, field) != getattr(self, field) for field in immutable_fields):
                raise ValidationError(_("Damage workflow relationships are immutable."))
            if previous.resolved_at and (
                self.resolved_at != previous.resolved_at
                or self.resolved_by_id != previous.resolved_by_id
                or self.resolution_notes != previous.resolution_notes
            ):
                raise ValidationError(_("Damage resolution is immutable."))
        self.full_clean()
        return super().save(*args, **kwargs)

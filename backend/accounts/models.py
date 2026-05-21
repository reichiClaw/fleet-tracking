"""User model and role definitions."""

from __future__ import annotations

import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _


class User(AbstractUser):
    """Application user with a stable role code for API permissions."""

    class Role(models.TextChoices):
        ADMIN = "admin", _("Admin")
        OPERATIONS = "operations", _("Operations")
        READONLY = "readonly", _("Read-only")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(blank=True)
    full_name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.READONLY)

    @property
    def display_name(self) -> str:
        return self.full_name or self.get_full_name() or self.username

    @property
    def is_admin_role(self) -> bool:
        return self.is_superuser or self.role == self.Role.ADMIN

    @property
    def is_operations_role(self) -> bool:
        return self.is_admin_role or self.role == self.Role.OPERATIONS

    @property
    def is_readonly_role(self) -> bool:
        return self.role == self.Role.READONLY

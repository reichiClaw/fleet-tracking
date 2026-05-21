"""Shared abstract model helpers."""

from __future__ import annotations

import uuid

from django.db import models


class TimeStampedUUIDModel(models.Model):
    """UUID primary key plus created/updated timestamps for domain records."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

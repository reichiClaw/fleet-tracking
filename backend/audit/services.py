"""Small, consistent helpers for append-only audit events."""

from __future__ import annotations

import json
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder

from audit.models import AuditLog


def _json_safe(value: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize serializer/model values for storage in a JSONField."""
    if not value:
        return {}
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def audit_event(
    *,
    actor,
    action: str,
    entity_type: str,
    entity_id=None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request_meta: dict[str, str] | None = None,
) -> AuditLog:
    request_meta = request_meta or {}
    return AuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=_json_safe(before),
        after=_json_safe(after),
        ip_address=request_meta.get("ip_address") or None,
        user_agent=request_meta.get("user_agent", "")[:1000],
    )

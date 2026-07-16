"""Small, consistent helpers for append-only audit events."""

from __future__ import annotations

from typing import Any

from audit.models import AuditLog


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
        before=before or {},
        after=after or {},
        ip_address=request_meta.get("ip_address") or None,
        user_agent=request_meta.get("user_agent", "")[:1000],
    )

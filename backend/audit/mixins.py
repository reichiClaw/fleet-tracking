"""Reusable mutation auditing for DRF model viewsets."""

from __future__ import annotations

from audit.services import audit_event
from config.request import request_metadata


class AuditedModelViewSetMixin:
    audit_entity_type: str | None = None

    def _audit_type(self) -> str:
        return self.audit_entity_type or self.queryset.model._meta.model_name

    def _audit_snapshot(self, instance) -> dict:
        return dict(self.get_serializer(instance).data)

    def perform_create(self, serializer):
        instance = serializer.save()
        audit_event(
            actor=self.request.user,
            action=f"{self._audit_type()}.created",
            entity_type=self._audit_type(),
            entity_id=instance.id,
            after=self._audit_snapshot(instance),
            request_meta=request_metadata(self.request),
        )

    def perform_update(self, serializer):
        before = self._audit_snapshot(serializer.instance)
        instance = serializer.save()
        audit_event(
            actor=self.request.user,
            action=f"{self._audit_type()}.updated",
            entity_type=self._audit_type(),
            entity_id=instance.id,
            before=before,
            after=self._audit_snapshot(instance),
            request_meta=request_metadata(self.request),
        )

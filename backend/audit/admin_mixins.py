"""Admin safeguards: no destructive deletes and audited master-data edits."""

from __future__ import annotations

from django.forms.models import model_to_dict

from audit.services import audit_event
from config.request import request_metadata


class NoDeleteAdminMixin:
    def has_delete_permission(self, request, obj=None):
        return False


class AuditedAdminMixin(NoDeleteAdminMixin):
    audit_entity_type: str | None = None

    def save_model(self, request, obj, form, change):
        before = self._snapshot(type(obj).objects.filter(pk=obj.pk).first()) if change else {}
        super().save_model(request, obj, form, change)
        entity_type = self.audit_entity_type or obj._meta.model_name
        audit_event(
            actor=request.user,
            action=f"{entity_type}.{'updated' if change else 'created'}.admin",
            entity_type=entity_type,
            entity_id=obj.pk,
            before=before,
            after=self._snapshot(obj),
            request_meta=request_metadata(request),
        )

    @staticmethod
    def _snapshot(obj):
        if obj is None:
            return {}
        values = model_to_dict(obj, exclude=["password"])
        return {key: _json_value(value) for key, value in values.items()}


class ImmutableAdminMixin(NoDeleteAdminMixin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


def _json_value(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)

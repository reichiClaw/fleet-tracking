"""Ownership-safe persistence and cleanup for resumable workflow drafts."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from audit.services import audit_event
from mediafiles.models import MediaFile, MediaType
from mediafiles.services import cleanup_storage_file
from workflows.models import WorkflowDraft


class DraftVersionConflict(Exception):
    def __init__(self, draft: WorkflowDraft):
        self.draft = draft
        super().__init__("draft version conflict")


@transaction.atomic
def upsert_workflow_draft(*, data: dict, actor, request_meta=None) -> tuple[WorkflowDraft, bool]:
    expected_version = data.pop("expected_version", None)
    scope_key = data.get("scope_key", "")
    draft = (
        WorkflowDraft.objects.select_for_update()
        .filter(
            owner=actor,
            workflow_type=data["workflow_type"],
            scope_key=scope_key,
        )
        .first()
    )
    created = draft is None
    if draft is not None and expected_version is None:
        raise serializers.ValidationError(
            {"expected_version": [_("Expected version is required when updating a draft.")]}
        )
    if draft is not None and expected_version != draft.version:
        raise DraftVersionConflict(draft)
    _validate_draft_media(data.get("staged_media_ids", []), actor)
    expires_at = timezone.now() + timedelta(hours=int(settings.WORKFLOW_DRAFT_TTL_HOURS))
    if draft is None:
        draft = WorkflowDraft(owner=actor, expires_at=expires_at, **data)
    else:
        for field in ("object_id", "form_data", "staged_media_ids", "step"):
            if field in data:
                setattr(draft, field, data[field])
        draft.version += 1
        draft.expires_at = expires_at
    draft.save()
    audit_event(
        actor=actor,
        action="workflow_draft.created" if created else "workflow_draft.saved",
        entity_type="workflow_draft",
        entity_id=draft.id,
        after={
            "workflow_type": draft.workflow_type,
            "scope_key": draft.scope_key,
            "step": draft.step,
            "version": draft.version,
            "staged_media_count": len(draft.staged_media_ids),
        },
        request_meta=request_meta,
    )
    return draft, created


@transaction.atomic
def discard_workflow_draft(*, draft: WorkflowDraft, actor, request_meta=None) -> None:
    draft = WorkflowDraft.objects.select_for_update().get(pk=draft.pk)
    if draft.owner_id != actor.pk and not getattr(actor, "is_admin_role", False):
        raise serializers.ValidationError({"detail": [_("You may only discard your own workflow drafts.")]})
    media_ids = list(draft.staged_media_ids)
    owner_id = draft.owner_id
    audit_event(
        actor=actor,
        action="workflow_draft.discarded",
        entity_type="workflow_draft",
        entity_id=draft.id,
        before={"workflow_type": draft.workflow_type, "version": draft.version},
        request_meta=request_meta,
    )
    draft.delete()
    _delete_unreferenced_staged_media(media_ids=media_ids, owner_id=owner_id, actor=actor)


@transaction.atomic
def expire_workflow_drafts(*, now=None) -> tuple[int, int]:
    now = now or timezone.now()
    expired = list(WorkflowDraft.objects.select_for_update().filter(expires_at__lte=now))
    media_by_owner: dict[object, list[str]] = {}
    for draft in expired:
        media_by_owner.setdefault(draft.owner_id, []).extend(draft.staged_media_ids)
        audit_event(
            actor=None,
            action="workflow_draft.expired",
            entity_type="workflow_draft",
            entity_id=draft.id,
            before={"workflow_type": draft.workflow_type, "version": draft.version},
        )
        draft.delete()
    deleted_media = 0
    for owner_id, ids in media_by_owner.items():
        deleted_media += _delete_unreferenced_staged_media(
            media_ids=ids,
            owner_id=owner_id,
            actor=None,
        )
    return len(expired), deleted_media


def active_draft_media_ids(*, now=None) -> set[str]:
    ids: set[str] = set()
    for values in WorkflowDraft.objects.filter(expires_at__gt=now or timezone.now()).values_list(
        "staged_media_ids",
        flat=True,
    ):
        ids.update(str(item) for item in values)
    return ids


def _validate_draft_media(media_ids, actor) -> None:
    ids = [str(item) for item in media_ids]
    if not ids:
        return
    media = list(MediaFile.objects.select_for_update().filter(pk__in=ids))
    if len(media) != len(set(ids)):
        raise serializers.ValidationError({"staged_media_ids": [_("One or more media files are unavailable.")]})
    for item in media:
        if item.uploaded_by_id != actor.pk or not item.is_staged:
            raise serializers.ValidationError(
                {"staged_media_ids": [_("Draft media must be staged uploads owned by the draft user.")]}
            )
        if item.media_type not in {MediaType.PHOTO, MediaType.SIGNATURE}:
            raise serializers.ValidationError(
                {"staged_media_ids": [_("This media type cannot be held by a workflow draft.")]}
            )


def _delete_unreferenced_staged_media(*, media_ids, owner_id, actor) -> int:
    held = active_draft_media_ids()
    ids = {str(item) for item in media_ids} - held
    media = list(
        MediaFile.objects.select_for_update().filter(
            pk__in=ids,
            uploaded_by_id=owner_id,
            attached_at__isnull=True,
            media_type__in=[MediaType.PHOTO, MediaType.SIGNATURE],
        )
    )
    for item in media:
        key = item.storage_key
        audit_event(
            actor=actor,
            action="media.expired",
            entity_type="media_file",
            entity_id=item.id,
            before={"media_type": item.media_type, "sha256": item.content_sha256},
        )
        item.delete()
        transaction.on_commit(lambda storage_key=key: cleanup_storage_file(storage_key))
    return len(media)

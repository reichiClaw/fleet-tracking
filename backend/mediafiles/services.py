"""Storage and validation helpers for media files."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone
from django.utils.text import get_valid_filename
from django.utils.translation import gettext as _
from rest_framework import serializers

from mediafiles.models import MediaFile, MediaType


_ALLOWED_UPLOADS = {
    MediaType.PHOTO: {
        "extensions": {".jpg", ".jpeg", ".png", ".gif", ".webp"},
        "content_types": {"image/jpeg", "image/png", "image/gif", "image/webp"},
    },
    MediaType.SIGNATURE: {
        "extensions": {".jpg", ".jpeg", ".png", ".webp"},
        "content_types": {"image/jpeg", "image/png", "image/webp"},
    },
    MediaType.PDF: {
        "extensions": {".pdf"},
        "content_types": {"application/pdf"},
    },
    MediaType.IMPORT: {
        "extensions": {".xlsx", ".xlsm"},
        "content_types": {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroEnabled.12",
        },
    },
}


def create_media_file_from_upload(
    *,
    uploaded_file,
    actor,
    media_type: str,
    vehicle=None,
    loan=None,
    damage_report=None,
    related_type: str = "",
    related_id=None,
    language: str = "",
) -> MediaFile:
    """Validate and persist an uploaded file under MEDIA_ROOT."""
    filename = _clean_filename(getattr(uploaded_file, "name", "upload"))
    content_type = _normalized_content_type(getattr(uploaded_file, "content_type", ""))
    size_bytes = int(getattr(uploaded_file, "size", 0) or 0)
    _validate_file(
        media_type=media_type,
        filename=filename,
        content_type=content_type,
        size_bytes=size_bytes,
        prefix=_file_prefix(uploaded_file),
    )
    try:
        uploaded_file.seek(0)
    except (AttributeError, OSError):
        pass

    storage_key = _storage_key(media_type=media_type, filename=filename)
    saved_key = default_storage.save(storage_key, uploaded_file)
    try:
        return MediaFile.objects.create(
            vehicle=vehicle,
            loan=loan,
            damage_report=damage_report,
            related_type=related_type,
            related_id=related_id,
            media_type=media_type,
            original_filename=filename,
            storage_key=saved_key,
            content_type=content_type,
            size_bytes=size_bytes,
            language=language,
            uploaded_by=actor,
        )
    except Exception:
        default_storage.delete(saved_key)
        raise
    finally:
        try:
            uploaded_file.seek(0)
        except (AttributeError, OSError):
            pass


def create_media_file_from_bytes(
    *,
    content: bytes,
    actor,
    media_type: str,
    filename: str,
    content_type: str,
    vehicle=None,
    loan=None,
    damage_report=None,
    related_type: str = "",
    related_id=None,
    language: str = "",
) -> MediaFile:
    """Persist generated media content and metadata."""
    clean_filename = _clean_filename(filename)
    normalized_content_type = _normalized_content_type(content_type)
    _validate_file(
        media_type=media_type,
        filename=clean_filename,
        content_type=normalized_content_type,
        size_bytes=len(content),
        prefix=content[:16],
    )
    storage_key = _storage_key(media_type=media_type, filename=clean_filename)
    saved_key = default_storage.save(storage_key, ContentFile(content))
    try:
        return MediaFile.objects.create(
            vehicle=vehicle,
            loan=loan,
            damage_report=damage_report,
            related_type=related_type,
            related_id=related_id,
            media_type=media_type,
            original_filename=clean_filename,
            storage_key=saved_key,
            content_type=normalized_content_type,
            size_bytes=len(content),
            language=language,
            uploaded_by=actor,
        )
    except Exception:
        default_storage.delete(saved_key)
        raise


def validate_existing_media_file(media: MediaFile) -> None:
    """Ensure metadata points to a stored file before serving it."""
    if not default_storage.exists(media.storage_key):
        raise serializers.ValidationError({"detail": _("Stored media file is missing.")})


def _validate_file(*, media_type: str, filename: str, content_type: str, size_bytes: int, prefix: bytes) -> None:
    if media_type not in _ALLOWED_UPLOADS:
        raise serializers.ValidationError({"media_type": _("Unsupported media type.")})
    if size_bytes <= 0:
        raise serializers.ValidationError({"file": _("File must not be empty.")})
    max_size = int(getattr(settings, "MAX_UPLOAD_SIZE_MB", 25)) * 1024 * 1024
    if size_bytes > max_size:
        raise serializers.ValidationError(
            {"file": _("File exceeds the maximum upload size of %(size)d MB.") % {"size": settings.MAX_UPLOAD_SIZE_MB}}
        )

    rules = _ALLOWED_UPLOADS[media_type]
    extension = Path(filename).suffix.lower()
    if extension not in rules["extensions"]:
        raise serializers.ValidationError({"file": _("File extension is not allowed for this media type.")})
    if content_type not in rules["content_types"]:
        raise serializers.ValidationError({"file": _("File content type is not allowed for this media type.")})
    if not _prefix_matches(media_type=media_type, extension=extension, prefix=prefix):
        raise serializers.ValidationError({"file": _("File content does not match the selected media type.")})


def _prefix_matches(*, media_type: str, extension: str, prefix: bytes) -> bool:
    if media_type in {MediaType.PHOTO, MediaType.SIGNATURE}:
        if extension in {".jpg", ".jpeg"}:
            return prefix.startswith(bytes.fromhex("ffd8ff"))
        if extension == ".png":
            return prefix.startswith(bytes.fromhex("89504e470d0a1a0a"))
        if extension == ".gif":
            return prefix.startswith((b"GIF87a", b"GIF89a"))
        if extension == ".webp":
            return len(prefix) >= 12 and prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP"
    if media_type == MediaType.PDF:
        return prefix.startswith(b"%PDF")
    if media_type == MediaType.IMPORT:
        return prefix.startswith(bytes.fromhex("504b0304"))
    return False


def _file_prefix(uploaded_file) -> bytes:
    try:
        uploaded_file.seek(0)
    except (AttributeError, OSError):
        pass
    prefix = uploaded_file.read(16)
    if isinstance(prefix, str):
        prefix = prefix.encode()
    try:
        uploaded_file.seek(0)
    except (AttributeError, OSError):
        pass
    return prefix or b""


def _storage_key(*, media_type: str, filename: str) -> str:
    now = timezone.now()
    extension = Path(filename).suffix.lower()
    return f"{media_type}/{now:%Y/%m/%d}/{uuid4().hex}{extension}"


def _clean_filename(filename: str) -> str:
    name = get_valid_filename(Path(filename or "upload").name)
    return name or "upload"


def _normalized_content_type(content_type: str) -> str:
    return (content_type or "application/octet-stream").split(";", 1)[0].strip().lower()

"""Environment-driven media storage backend selection.

A single ``MEDIA_STORAGE_BACKEND`` variable chooses where uploaded media
(photos, signatures, generated PDFs, import files) is stored:

- ``local`` (default): filesystem under ``MEDIA_ROOT`` (a Docker volume).
- ``sftp``: a remote SFTP/NAS server via django-storages + paramiko.
- ``s3``: S3-compatible object storage (AWS S3 or MinIO) via boto3.

The application always serves media through authenticated Django download
endpoints, so the chosen backend never needs to expose public URLs.
"""

from __future__ import annotations

from collections.abc import Mapping

from django.core.exceptions import ImproperlyConfigured

WHITENOISE_STATIC_BACKEND = "whitenoise.storage.CompressedManifestStaticFilesStorage"
FILESYSTEM_BACKEND = "django.core.files.storage.FileSystemStorage"
S3_BACKEND = "storages.backends.s3.S3Storage"
SFTP_BACKEND = "storages.backends.sftpstorage.SFTPStorage"

_TRUTHY = {"1", "true", "yes", "on"}


def _drop_empty(options: dict) -> dict:
    """Remove keys whose value is ``None`` so backends apply their own defaults."""
    return {key: value for key, value in options.items() if value is not None}


def build_storages(env: Mapping[str, str]) -> dict:
    """Return Django's ``STORAGES`` mapping for the configured media backend."""
    backend = (env.get("MEDIA_STORAGE_BACKEND") or "local").strip().lower()

    def get(name: str, default: str | None = None, *, required: bool = False) -> str | None:
        value = env.get(name, default)
        if required and not value:
            raise ImproperlyConfigured(
                f"{name} is required when MEDIA_STORAGE_BACKEND={backend}."
            )
        return value

    def get_bool(name: str, default: bool) -> bool:
        value = env.get(name)
        if value is None or value == "":
            return default
        return value.strip().lower() in _TRUTHY

    if backend == "local":
        default_storage = {"BACKEND": FILESYSTEM_BACKEND}
    elif backend == "s3":
        default_storage = {
            "BACKEND": S3_BACKEND,
            "OPTIONS": _drop_empty(
                {
                    "bucket_name": get("AWS_STORAGE_BUCKET_NAME", required=True),
                    "region_name": get("AWS_S3_REGION_NAME", "") or None,
                    "endpoint_url": get("AWS_S3_ENDPOINT_URL", "") or None,
                    "access_key": get("AWS_ACCESS_KEY_ID", "") or None,
                    "secret_key": get("AWS_SECRET_ACCESS_KEY", "") or None,
                    "default_acl": get("AWS_DEFAULT_ACL", "private") or None,
                    "querystring_auth": get_bool("AWS_QUERYSTRING_AUTH", True),
                    "addressing_style": get("AWS_S3_ADDRESSING_STYLE", "") or None,
                    "file_overwrite": False,
                }
            ),
        }
    elif backend == "sftp":
        params = {
            "username": get("SFTP_USER", required=True),
            "port": int(get("SFTP_PORT", "22") or "22"),
        }
        password = get("SFTP_PASSWORD", "")
        key_filename = get("SFTP_KEY_PATH", "")
        if password:
            params["password"] = password
        if key_filename:
            params["key_filename"] = key_filename
        default_storage = {
            "BACKEND": SFTP_BACKEND,
            "OPTIONS": _drop_empty(
                {
                    "host": get("SFTP_HOST", required=True),
                    "root_path": get("SFTP_ROOT", "/fleet-media/"),
                    "params": params,
                    "known_host_file": get("SFTP_KNOWN_HOSTS", "") or None,
                }
            ),
        }
    else:
        raise ImproperlyConfigured(
            "MEDIA_STORAGE_BACKEND must be one of: local, sftp, s3 "
            f"(got {backend!r})."
        )

    return {
        "default": default_storage,
        "staticfiles": {"BACKEND": WHITENOISE_STATIC_BACKEND},
    }

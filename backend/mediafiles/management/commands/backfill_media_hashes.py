"""Backfill SHA-256 metadata for media created before integrity hardening."""

import hashlib

from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from audit.services import audit_event
from mediafiles.models import MediaFile


class Command(BaseCommand):
    help = "Backfill missing SHA-256 hashes for stored media."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=200)

    def handle(self, *args, **options):
        batch_size = max(1, options["batch_size"])
        queryset = MediaFile.objects.filter(content_sha256="").order_by("created_at")
        updated = 0
        missing = 0
        for media in queryset.iterator(chunk_size=batch_size):
            if not default_storage.exists(media.storage_key):
                missing += 1
                self.stderr.write(f"Missing storage object for media {media.id}")
                continue
            digest = hashlib.sha256()
            try:
                with default_storage.open(media.storage_key, "rb") as stored:
                    while chunk := stored.read(1024 * 1024):
                        digest.update(chunk)
            except OSError as exc:
                raise CommandError(f"Could not read media {media.id}: {exc}") from exc
            content_sha256 = digest.hexdigest()
            with transaction.atomic():
                changed = MediaFile.objects.filter(pk=media.pk, content_sha256="").update(
                    content_sha256=content_sha256
                )
                if not changed:
                    continue
                audit_event(
                    actor=None,
                    action="media.hash_backfilled",
                    entity_type="media_file",
                    entity_id=media.id,
                    before={"content_sha256": ""},
                    after={"content_sha256": content_sha256},
                )
            updated += 1
        self.stdout.write(
            self.style.SUCCESS(f"Backfilled {updated} media hashes; {missing} storage objects were missing.")
        )

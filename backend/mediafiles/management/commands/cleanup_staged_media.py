"""Remove expired media uploads that were never attached."""

from django.core.management.base import BaseCommand

from mediafiles.services import expire_staged_media
from workflows.drafts import expire_workflow_drafts


class Command(BaseCommand):
    help = "Delete unattached photo/signature uploads older than STAGED_MEDIA_TTL_HOURS."

    def handle(self, *args, **options):
        drafts, draft_media = expire_workflow_drafts()
        deleted = expire_staged_media()
        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {drafts} expired draft(s) and {deleted + draft_media} expired staged media file(s)."
            )
        )

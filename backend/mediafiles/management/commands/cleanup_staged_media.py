"""Remove expired media uploads that were never attached."""

from django.core.management.base import BaseCommand

from mediafiles.services import expire_staged_media


class Command(BaseCommand):
    help = "Delete unattached photo/signature uploads older than STAGED_MEDIA_TTL_HOURS."

    def handle(self, *args, **options):
        deleted = expire_staged_media()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired staged media file(s)."))

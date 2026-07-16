# Generated for backend hardening.

from django.db import migrations, models


def mark_existing_media(apps, schema_editor):
    MediaFile = apps.get_model("mediafiles", "MediaFile")
    attached = (
        models.Q(vehicle_id__isnull=False)
        | models.Q(loan_id__isnull=False)
        | models.Q(damage_report_id__isnull=False)
        | ~models.Q(related_type="")
        | models.Q(related_id__isnull=False)
    )
    generated_types = {
        "check_in_protocol_pdf",
        "loan_checkout_pdf",
        "loan_return_pdf",
        "manufacturer_checkout_protocol_pdf",
    }
    for media in MediaFile.objects.filter(attached):
        media.attached_at = media.created_at
        media.is_generated = media.media_type == "pdf" and media.related_type in generated_types
        media.save(update_fields=["attached_at", "is_generated"])


def mark_duplicate_generated_pdfs_as_legacy(apps, schema_editor):
    MediaFile = apps.get_model("mediafiles", "MediaFile")
    AuditLog = apps.get_model("audit", "AuditLog")
    duplicates = (
        MediaFile.objects.filter(media_type="pdf", is_generated=True)
        .values("related_type", "related_id", "language")
        .annotate(count=models.Count("id"))
        .filter(count__gt=1)
    )
    for duplicate in duplicates:
        records = list(
            MediaFile.objects.filter(
                media_type="pdf",
                is_generated=True,
                related_type=duplicate["related_type"],
                related_id=duplicate["related_id"],
                language=duplicate["language"],
            ).order_by("created_at", "id")
        )
        for media in records[1:]:
            media.is_generated = False
            media.save(update_fields=["is_generated"])
            AuditLog.objects.create(
                action="migration.pdf_duplicate_marked_legacy",
                entity_type="media_file",
                entity_id=media.id,
                before={"is_generated": True},
                after={"is_generated": False},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0001_initial"),
        ("mediafiles", "0003_mediafile_language"),
    ]

    operations = [
        migrations.AddField(
            model_name="mediafile",
            name="attached_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="mediafile",
            name="content_sha256",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="mediafile",
            name="is_generated",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_existing_media, migrations.RunPython.noop),
        migrations.RunPython(mark_duplicate_generated_pdfs_as_legacy, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="mediafile",
            index=models.Index(fields=["media_type", "-created_at"], name="media_type_created_idx"),
        ),
        migrations.AddIndex(
            model_name="mediafile",
            index=models.Index(fields=["related_type", "related_id"], name="media_related_idx"),
        ),
        migrations.AddIndex(
            model_name="mediafile",
            index=models.Index(fields=["uploaded_by", "attached_at"], name="media_staging_owner_idx"),
        ),
        migrations.AddConstraint(
            model_name="mediafile",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_generated", True), ("media_type", "pdf")),
                fields=("related_type", "related_id", "language"),
                name="unique_pdf_record_type_language",
            ),
        ),
    ]

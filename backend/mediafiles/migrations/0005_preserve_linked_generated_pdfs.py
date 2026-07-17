from django.db import migrations


DOCUMENT_LINKS = (
    ("workflows", "CheckInProtocol", "pdf_media_id", "check_in_protocol_pdf"),
    ("workflows", "Loan", "checkout_pdf_media_id", "loan_checkout_pdf"),
    ("workflows", "Loan", "return_pdf_media_id", "loan_return_pdf"),
    (
        "workflows",
        "ManufacturerCheckOutProtocol",
        "pdf_media_id",
        "manufacturer_checkout_protocol_pdf",
    ),
)


def preserve_linked_generated_pdfs(apps, schema_editor):
    MediaFile = apps.get_model("mediafiles", "MediaFile")
    AuditLog = apps.get_model("audit", "AuditLog")

    for app_label, model_name, link_field, related_type in DOCUMENT_LINKS:
        Record = apps.get_model(app_label, model_name)
        for record in Record.objects.exclude(**{f"{link_field}__isnull": True}).values("id", link_field):
            linked = MediaFile.objects.filter(
                pk=record[link_field],
                media_type="pdf",
                related_type=related_type,
                related_id=record["id"],
            ).first()
            if linked is None or linked.is_generated:
                continue

            current = MediaFile.objects.filter(
                media_type="pdf",
                is_generated=True,
                related_type=related_type,
                related_id=record["id"],
                language=linked.language,
            ).first()
            if current is not None:
                current.is_generated = False
                current.save(update_fields=["is_generated"])

            linked.is_generated = True
            linked.save(update_fields=["is_generated"])
            AuditLog.objects.create(
                action="migration.linked_pdf_preserved",
                entity_type="media_file",
                entity_id=linked.id,
                before={
                    "is_generated": False,
                    "replaced_generated_media_id": str(current.id) if current else None,
                },
                after={"is_generated": True},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("mediafiles", "0004_media_integrity"),
        ("workflows", "0005_hardening_snapshots_constraints"),
    ]

    operations = [
        migrations.RunPython(
            preserve_linked_generated_pdfs,
            migrations.RunPython.noop,
        ),
    ]

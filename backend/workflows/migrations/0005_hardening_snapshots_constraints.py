# Generated for backend hardening.

import django.db.models.deletion
from django.db import migrations, models


def cancel_duplicate_active_loans(apps, schema_editor):
    Loan = apps.get_model("workflows", "Loan")
    AuditLog = apps.get_model("audit", "AuditLog")
    duplicates = (
        Loan.objects.filter(status="active")
        .values("vehicle_id")
        .annotate(count=models.Count("id"))
        .filter(count__gt=1)
    )
    for duplicate in duplicates:
        loans = list(
            Loan.objects.filter(vehicle_id=duplicate["vehicle_id"], status="active").order_by("-created_at", "-id")
        )
        for loan in loans[1:]:
            loan.status = "cancelled"
            loan.save(update_fields=["status", "updated_at"])
            AuditLog.objects.create(
                action="migration.loan_duplicate_cancelled",
                entity_type="loan",
                entity_id=loan.id,
                before={"status": "active", "vehicle_id": str(loan.vehicle_id)},
                after={"status": "cancelled"},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0001_initial"),
        ("mediafiles", "0004_media_integrity"),
        ("workflows", "0004_reservation"),
    ]

    operations = [
        migrations.AddField(
            model_name="checkinprotocol",
            name="idempotency_key",
            field=models.CharField(blank=True, max_length=128, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="checkinprotocol",
            name="pdf_generation_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="checkinprotocol",
            name="request_fingerprint",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="checkinprotocol",
            name="snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="loan",
            name="checkout_pdf_generation_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="loan",
            name="checkout_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="loan",
            name="return_pdf_generation_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="loan",
            name="return_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="manufacturercheckoutprotocol",
            name="pdf_generation_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="manufacturercheckoutprotocol",
            name="snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name="checkinprotocol",
            name="pdf_media",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="mediafiles.mediafile",
            ),
        ),
        migrations.AlterField(
            model_name="loan",
            name="checkout_pdf_media",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="loan_checkout_documents",
                to="mediafiles.mediafile",
            ),
        ),
        migrations.AlterField(
            model_name="loan",
            name="return_pdf_media",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="loan_return_documents",
                to="mediafiles.mediafile",
            ),
        ),
        migrations.AlterField(
            model_name="manufacturercheckoutprotocol",
            name="pdf_media",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="mediafiles.mediafile",
            ),
        ),
        migrations.AlterField(
            model_name="reservation",
            name="vehicle",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="reservations",
                to="vehicles.vehicle",
            ),
        ),
        migrations.RunPython(cancel_duplicate_active_loans, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="loan",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "active")),
                fields=("vehicle",),
                name="unique_active_loan_per_vehicle",
            ),
        ),
        migrations.AddIndex(
            model_name="loan",
            index=models.Index(fields=["status", "expected_return_at"], name="loan_status_expected_idx"),
        ),
        migrations.AddIndex(
            model_name="loan",
            index=models.Index(fields=["vehicle", "-created_at"], name="loan_vehicle_created_idx"),
        ),
        migrations.AddIndex(
            model_name="reservation",
            index=models.Index(
                fields=["vehicle", "status", "start_at", "end_at"],
                name="reservation_overlap_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="reservation",
            index=models.Index(fields=["status", "start_at"], name="reservation_status_idx"),
        ),
        migrations.AddIndex(
            model_name="checkinprotocol",
            index=models.Index(fields=["vehicle", "-performed_at"], name="checkin_vehicle_time_idx"),
        ),
        migrations.AddIndex(
            model_name="manufacturercheckoutprotocol",
            index=models.Index(fields=["vehicle", "-performed_at"], name="manufacturer_time_idx"),
        ),
    ]

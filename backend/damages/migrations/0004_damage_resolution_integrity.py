# Generated for backend hardening.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("damages", "0003_damagereport_workflow_phase"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="damagereport",
            name="resolution_notes",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="damagereport",
            name="resolved_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="resolved_damage_reports",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="damagereport",
            index=models.Index(
                fields=["vehicle", "resolved_at", "-discovered_at"],
                name="damage_vehicle_open_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="damagereport",
            index=models.Index(fields=["workflow_phase", "-discovered_at"], name="damage_phase_time_idx"),
        ),
    ]

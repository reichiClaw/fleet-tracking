# Generated for backend hardening.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vehicles", "0004_vehicle_manufacturer_return_due"),
    ]

    operations = [
        migrations.CreateModel(
            name="VehicleNumberSequence",
            fields=[
                ("name", models.CharField(max_length=32, primary_key=True, serialize=False)),
                ("next_value", models.PositiveBigIntegerField(default=1)),
            ],
        ),
        migrations.AddIndex(
            model_name="vehicle",
            index=models.Index(fields=["status", "-updated_at"], name="vehicle_status_updated_idx"),
        ),
        migrations.AddIndex(
            model_name="vehicle",
            index=models.Index(fields=["category", "status"], name="vehicle_category_status_idx"),
        ),
        migrations.AddIndex(
            model_name="vehicle",
            index=models.Index(fields=["archived_at"], name="vehicle_archived_idx"),
        ),
    ]

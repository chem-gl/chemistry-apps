# Generated for must_change_password flag on UserIdentityProfile.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_scientific_job_expires_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="useridentityprofile",
            name="must_change_password",
            field=models.BooleanField(default=False),
        ),
    ]

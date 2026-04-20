# Minimal post-reset migration: las cuentas demo se sacaron del histórico de BD.

from django.db import migrations


def noop_forward(apps, schema_editor) -> None:
    """No inserta usuarios de ejemplo ni contraseñas fijas en instalaciones nuevas.

    El bootstrap real del root ya vive en `apps.core.identity.startup`, por lo que
    mantener usuarios demo dentro del histórico de migraciones solo añade ruido y
    datos innecesarios a una base de datos recién recreada.
    """
    del apps, schema_editor


def noop_reverse(apps, schema_editor) -> None:
    """No hay cambios de datos que revertir en esta migración reducida."""
    del apps, schema_editor


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(noop_forward, noop_reverse),
    ]

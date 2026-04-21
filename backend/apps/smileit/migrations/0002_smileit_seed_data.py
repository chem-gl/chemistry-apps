# Minimal canonical Smile-it seed migration for fresh databases.

from django.db import migrations

from apps.smileit.seed_bootstrap import (
    apply_smileit_seed_data,
    deactivate_smileit_seed_data,
)


def seed_smileit_reference_data(apps, schema_editor) -> None:
    """Carga el catálogo base de Smile-it reutilizando la lógica canónica del proyecto."""
    del schema_editor
    apply_smileit_seed_data(
        category_model=apps.get_model("smileit", "SmileitCategory"),
        substituent_model=apps.get_model("smileit", "SmileitSubstituent"),
        link_model=apps.get_model("smileit", "SmileitSubstituentCategory"),
        pattern_model=apps.get_model("smileit", "SmileitPattern"),
    )


def reverse_seed_data(apps, schema_editor) -> None:
    """Desactiva los seeds en vez de borrarlos para mantener trazabilidad."""
    del schema_editor
    deactivate_smileit_seed_data(
        category_model=apps.get_model("smileit", "SmileitCategory"),
        substituent_model=apps.get_model("smileit", "SmileitSubstituent"),
        pattern_model=apps.get_model("smileit", "SmileitPattern"),
    )


class Migration(migrations.Migration):
    """Carga el catálogo semilla mínimo y consistente de Smile-it para instalaciones frescas."""

    dependencies = [
        ("smileit", "0001_initial"),
    ]

    operations = [migrations.RunPython(seed_smileit_reference_data, reverse_seed_data)]

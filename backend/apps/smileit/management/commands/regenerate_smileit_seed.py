"""management/commands/regenerate_smileit_seed.py: Regenera datos semilla de Smile-it.

Comando para restablecer el catálogo, categorías y patrones iniciales de Smile-it.
Útil si se borran migraciones o si necesitas reinicializar los datos sin migrar.

Uso:
    poetry run python manage.py regenerate_smileit_seed
    poetry run python manage.py regenerate_smileit_seed --reset  # Borra primero
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.smileit.models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)
from apps.smileit.seed_bootstrap import apply_smileit_seed_data


class Command(BaseCommand):
    """Regenera datos semilla de Smile-it (categorías, sustituyentes y patrones)."""

    help = "Regenera datos semilla de Smile-it. Usa --reset para borrar y reiniciar."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Borra todos los datos de Smile-it antes de regenerar (DESTRUCTIVO).",
        )

    def handle(self, *args: object, **options: object) -> None:
        del args
        reset = bool(options.get("reset", False))

        if reset:
            self.stdout.write(
                self.style.WARNING(
                    "⚠️  Borrando todos los datos de Smile-it (categorías, sustituyentes, patrones)..."
                )
            )
            SmileitCategory.objects.all().delete()
            SmileitSubstituent.objects.all().delete()
            SmileitPattern.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("✓ Datos borrados."))

        self.stdout.write("Regenerando datos semilla de Smile-it...")
        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )
        self.stdout.write(
            self.style.SUCCESS(
                "✓ Datos semilla de Smile-it regenerados correctamente "
                f"({SmileitCategory.objects.filter(is_latest=True, is_active=True).count()} categorías, "
                f"{SmileitSubstituent.objects.filter(is_latest=True, is_active=True).count()} sustituyentes, "
                f"{SmileitPattern.objects.filter(is_latest=True, is_active=True).count()} patrones)."
            )
        )

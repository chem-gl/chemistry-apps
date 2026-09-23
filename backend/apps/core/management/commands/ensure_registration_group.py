"""ensure_registration_group.py: Crea el grupo de acogida del registro público.

Uso: DEFAULT_REGISTRATION_GROUP_SLUG=abierto poetry run python manage.py ensure_registration_group

Idempotente: si el grupo ya existe no hace nada. El grupo nace sin permisos
de app; root los otorga después si corresponde. Los nuevos registros sin token
caen en este grupo como miembros.
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand

from apps.core.models import WorkGroup

DEFAULT_SLUG = "abierto"
DEFAULT_NAME = "Abierto"
DEFAULT_DESCRIPTION = (
    "Grupo de acogida del registro público: usuarios sin cuenta previa. "
    "Sin acceso a apps con cuenta salvo que root lo otorgue."
)


class Command(BaseCommand):
    """Garantiza que exista el grupo de acogida del registro sin token."""

    help = "Crea el grupo de acogida del registro público si no existe."

    def handle(self, *args, **options) -> None:
        del args, options
        group_slug = os.getenv("DEFAULT_REGISTRATION_GROUP_SLUG", DEFAULT_SLUG).strip()
        if not group_slug:
            self.stdout.write("Registro sin grupo de acogida; no se crea ningún grupo.")
            return

        group, created = WorkGroup.objects.get_or_create(
            slug=group_slug,
            defaults={"name": DEFAULT_NAME, "description": DEFAULT_DESCRIPTION},
        )
        if created:
            self.stdout.write(
                self.style.SUCCESS(f"Grupo de acogida creado: slug={group.slug}")
            )
        else:
            self.stdout.write(f"Grupo de acogida existente: slug={group.slug}")

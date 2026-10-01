"""ensure_qta_operators.py: Crea el grupo qta-operators (idempotente).

Uso:
    python manage.py ensure_qta_operators

Garantiza WorkGroup qta-operators + AppPermission(server-calc) + membresía
admin de root. Útil tras despliegues donde post_migrate no tuvo migraciones
que aplicar.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.server_calc.bootstrap_qta import ensure_qta_operators_group


class Command(BaseCommand):
    """Ejecuta el bootstrap del grupo qta-operators."""

    help = "Crea el grupo qta-operators con acceso a Server Calc (idempotente)."

    def handle(self, *args: object, **options: object) -> str:
        """Crea grupo + permiso + membresía root."""
        del args, options
        group, group_created = ensure_qta_operators_group()
        if group is None:
            return "server-calc no registrada: nada que hacer."
        status = "creado" if group_created else "ya existía"
        return f"Grupo {group.slug} {status} con acceso a Server Calc."

"""ensure_root_user.py: Comando para bootstrap idempotente del usuario root.

Uso: ./venv/bin/python manage.py ensure_root_user
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from ...identity.bootstrap.root_user import ensure_root_user


class Command(BaseCommand):
    """Crea el usuario root inicial si no existe."""

    help = "Garantiza que exista el usuario administrativo inicial en el sistema."

    def handle(self, *args, **options) -> None:
        del args, options
        root_user, generated_password, was_created = ensure_root_user()
        if not was_created:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Usuario administrativo existente: username={root_user.username}, email={root_user.email}"
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Usuario administrativo creado: username={root_user.username}, email={root_user.email}"
            )
        )
        self.stdout.write(
            self.style.WARNING(
                f"Password inicial del usuario administrativo (mostrar una sola vez): {generated_password}"
            )
        )

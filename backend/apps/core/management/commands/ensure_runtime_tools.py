"""ensure_runtime_tools.py: Comando de bootstrap para runtimes científicos externos.

Objetivo del archivo:
- Preparar automáticamente JREs y JARs requeridos por el backend científico.
- Exponer modo de verificación estricta para CI, arranque de contenedores y
  validaciones operativas previas a levantar servicios.

Cómo se usa:
- Descargar y validar: `python manage.py ensure_runtime_tools`
- Solo validar (sin descargas): `python manage.py ensure_runtime_tools --check-only`
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.core.runtime_tools import (
    RuntimeToolsError,
    assert_runtime_tools_ready,
    ensure_runtime_tools_ready,
    get_runtime_tools_root,
)


class Command(BaseCommand):
    """Descarga/verifica herramientas externas requeridas por el backend."""

    help = "Garantiza runtimes externos (JRE/JAR) y valida que estén operativos."

    def add_arguments(self, parser: CommandParser) -> None:
        """Define flags del comando para modo validación o bootstrap."""
        parser.add_argument(
            "--check-only",
            action="store_true",
            help="Solo valida artefactos requeridos sin descargar faltantes.",
        )

    def handle(self, *args: object, **options: object) -> None:
        """Ejecuta bootstrap o verificación estricta según opciones recibidas."""
        runtime_tools_root = get_runtime_tools_root()
        check_only_value: bool = bool(options.get("check_only", False))

        try:
            if check_only_value:
                assert_runtime_tools_ready(runtime_tools_root)
                self.stdout.write(
                    self.style.SUCCESS(
                        "Runtime tools verificados correctamente en "
                        f"{runtime_tools_root.as_posix()}"
                    )
                )
                return

            ensure_runtime_tools_ready(runtime_tools_root)
            self.stdout.write(
                self.style.SUCCESS(
                    "Runtime tools preparados y validados en "
                    f"{runtime_tools_root.as_posix()}"
                )
            )
        except RuntimeToolsError as exc:
            raise CommandError(str(exc)) from exc

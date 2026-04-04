#!/usr/bin/env python
"""manage.py: Punto de entrada CLI del backend Django.

Objetivo del archivo:
- Centralizar ejecución de comandos administrativos (`runserver`, `migrate`,
  `test`, comandos custom de `apps.core.management.commands`, etc.).

Cómo se usa:
- Desarrollo local: `python manage.py runserver`.
- Operación/automatización en servidor: `python manage.py <comando>` dentro del
  entorno virtual configurado.
- Es independiente del editor: puede ejecutarse igual desde terminal en VS Code,
  PyCharm, Vim o cualquier IDE/editor.
"""

import os
import sys


def main() -> None:
    """Configura settings y delega en el despachador oficial de Django."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    # `execute_from_command_line` resuelve el subcomando y ejecuta su handler.
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()

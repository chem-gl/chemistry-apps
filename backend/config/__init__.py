"""__init__.py: Exporta la app de Celery del proyecto de configuración.

Objetivo del archivo:
- Permitir que herramientas externas descubran `celery_app` al importar
        `config` sin conocer detalles internos de `config.celery`.

Uso típico:
- `from config import celery_app`
"""

from .celery import app as celery_app

__all__ = ("celery_app",)

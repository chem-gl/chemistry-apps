"""upload_limits.py: Topes de subida diferenciados por rol del job.

Los jobs anónimos (sin dueño) aceptan archivos más pequeños que los jobs de un
usuario registrado. El tope se resuelve desde el propio job para no duplicar
lógica entre apps con artefactos (Easy-rate, Marcus).

Configuración (bytes, por entorno):
- ``ANONYMOUS_MAX_UPLOAD_BYTES``: por defecto 10 MB.
- ``REGISTERED_MAX_UPLOAD_BYTES``: por defecto 50 MB.
"""

from __future__ import annotations

from django.conf import settings

from .models import ScientificJob

ANONYMOUS_MAX_UPLOAD_BYTES_DEFAULT: int = 10 * 1024 * 1024
REGISTERED_MAX_UPLOAD_BYTES_DEFAULT: int = 50 * 1024 * 1024


def resolve_max_upload_bytes(job: ScientificJob) -> int:
    """Retorna el tope por archivo aplicable al job (anónimo o con dueño)."""
    if job.owner_id is None:
        configured_value = int(
            getattr(
                settings,
                "ANONYMOUS_MAX_UPLOAD_BYTES",
                ANONYMOUS_MAX_UPLOAD_BYTES_DEFAULT,
            )
        )
    else:
        configured_value = int(
            getattr(
                settings,
                "REGISTERED_MAX_UPLOAD_BYTES",
                REGISTERED_MAX_UPLOAD_BYTES_DEFAULT,
            )
        )

    return max(1, configured_value)


def format_megabytes(size_bytes: int) -> str:
    """Formatea bytes como MB con un decimal, para mensajes de error legibles."""
    return f"{size_bytes / (1024 * 1024):.1f} MB"

"""exceptions.py: Manejo de errores del API científico.

Objetivo del archivo:
- Traducir excepciones de infraestructura (p. ej. cuerpo de request demasiado
  grande) a respuestas HTTP consistentes con el contrato del proyecto.

Cómo se usa:
- Registrado en ``REST_FRAMEWORK['EXCEPTION_HANDLER']``.
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import RequestDataTooBig
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

PAYLOAD_TOO_LARGE_DETAIL: str = (
    "El cuerpo de la petición supera el tamaño máximo permitido. "
    "Reduce el tamaño de los parámetros enviados."
)


def scientific_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Maneja excepciones DRF y traduce las de infraestructura a su status correcto.

    Django limita el cuerpo de la petición con ``DATA_UPLOAD_MAX_MEMORY_SIZE`` y
    lanza ``RequestDataTooBig`` (subclase de ``SuspiciousOperation``), que por
    defecto terminaría en 400. Aquí se responde **413**, el status correcto.
    """
    if isinstance(exc, RequestDataTooBig):
        return Response(
            {"detail": PAYLOAD_TOO_LARGE_DETAIL},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    return exception_handler(exc, context)

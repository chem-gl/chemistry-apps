"""uuid_utils.py: Utilidades de normalización de identificadores UUID.

Evita respuestas 500 cuando un cliente envía un identificador con formato
inválido en la URL: se traduce a ``None`` y el llamador decide el 404.
"""

from __future__ import annotations

from uuid import UUID


def resolve_uuid_or_none(raw_value: object) -> UUID | None:
    """Convierte un valor a ``UUID``; retorna ``None`` si el formato es inválido."""
    if isinstance(raw_value, UUID):
        return raw_value

    if raw_value is None:
        return None

    try:
        return UUID(str(raw_value))
    except (AttributeError, TypeError, ValueError):
        return None

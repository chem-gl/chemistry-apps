"""_naming.py: Reglas de naming compartidas para derivados y exports Smile-it.

Centraliza la normalización del job name para que los identificadores visibles,
los nombres de derivados y los archivos exportados usen el mismo formato.
"""

from __future__ import annotations

import re

DEFAULT_EXPORT_NAME_BASE = "SMILEIT"


def normalize_export_name_base(raw_export_name_base: str) -> str:
    """Normaliza el nombre base del trabajo para usarlo como identificador."""
    stripped_export_name_base = raw_export_name_base.strip()
    if stripped_export_name_base == "":
        stripped_export_name_base = DEFAULT_EXPORT_NAME_BASE

    normalized_export_name_base = re.sub(
        r"[^0-9A-Za-z_-]+", "_", stripped_export_name_base
    )
    normalized_export_name_base = re.sub(r"_+", "_", normalized_export_name_base).strip(
        "_"
    )

    return normalized_export_name_base or DEFAULT_EXPORT_NAME_BASE


def build_derivative_identifier(export_name_base: str, index_value: int) -> str:
    """Construye el identificador canónico de un derivado: d{jobName}{N}."""
    normalized_export_name_base = normalize_export_name_base(export_name_base)
    safe_index_value = max(1, index_value)
    return f"d{normalized_export_name_base}{safe_index_value}"


def build_principal_identifier(export_name_base: str) -> str:
    """Construye el identificador canónico para la molécula principal."""
    normalized_export_name_base = normalize_export_name_base(export_name_base)
    return f"{normalized_export_name_base} molecula principal"

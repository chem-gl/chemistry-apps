"""_validation.py: Validaciones de presencia e integridad de runtime tools.

Contiene verificaciones de archivos ejecutables/JAR requeridos y lógica
para reportar o elevar faltantes en modo estricto.
"""

from __future__ import annotations

import os
import zipfile
from pathlib import Path

from ._config import get_runtime_tools_root, is_runtime_tools_strict_check_enabled
from ._models import REQUIRED_RUNTIME_TOOLS, RuntimeToolRequirement, RuntimeToolsError


def _resolve_requirement_path(
    requirement: RuntimeToolRequirement,
    runtime_tools_root: Path,
) -> Path:
    """Construye ruta absoluta de un requisito a partir de su ruta relativa."""
    return runtime_tools_root / requirement.relative_path


def _is_valid_zip_file(file_path: Path) -> bool:
    """Valida si un archivo se comporta como ZIP/JAR legible."""
    if not file_path.exists() or not file_path.is_file():
        return False
    return zipfile.is_zipfile(file_path)


def _is_executable_file(file_path: Path) -> bool:
    """Determina si una ruta existe y es ejecutable por el proceso actual."""
    return file_path.exists() and file_path.is_file() and os.access(file_path, os.X_OK)


def get_missing_runtime_files(
    runtime_tools_root: Path | None = None,
    *,
    strict_check: bool | None = None,
) -> list[str]:
    """Lista faltantes o inválidos de runtime tools requeridos por el backend."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    effective_strict_check: bool = (
        is_runtime_tools_strict_check_enabled()
        if strict_check is None
        else strict_check
    )
    missing_messages: list[str] = []

    for requirement in REQUIRED_RUNTIME_TOOLS:
        if requirement.optional_when_non_strict and not effective_strict_check:
            continue

        requirement_path: Path = _resolve_requirement_path(requirement, resolved_root)
        if not requirement_path.exists():
            missing_messages.append(
                f"{requirement.key}: no existe {requirement_path.as_posix()}"
            )
            continue

        if requirement.must_be_executable and not _is_executable_file(requirement_path):
            missing_messages.append(
                f"{requirement.key}: no es ejecutable {requirement_path.as_posix()}"
            )

        if requirement.must_be_zip_file and not _is_valid_zip_file(requirement_path):
            missing_messages.append(
                f"{requirement.key}: JAR inválido/corrupto {requirement_path.as_posix()}"
            )

    return missing_messages


def assert_runtime_tools_ready(
    runtime_tools_root: Path | None = None,
    *,
    strict_check: bool | None = None,
) -> None:
    """Falla con excepción si falta algún artefacto de runtime obligatorio."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    missing_messages: list[str] = get_missing_runtime_files(
        resolved_root,
        strict_check=strict_check,
    )

    if len(missing_messages) == 0:
        return

    details: str = "; ".join(missing_messages)
    raise RuntimeToolsError(
        "Faltan artefactos de runtime científico obligatorios. "
        f"RUNTIME_TOOLS_DIR={resolved_root.as_posix()} | Detalle: {details}"
    )

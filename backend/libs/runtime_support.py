"""
# runtime_support.py

Utilidades compartidas para resolver rutas de runtimes científicos (JRE/JAR)
y normalizar entradas SMILES en librerías desacopladas de backend/libs.

Uso:
    from libs.runtime_support import RuntimePathsResolver, normalize_smiles_input

    resolver = RuntimePathsResolver()
    java8_path = resolver.get_java8_bin_path()
    smiles = normalize_smiles_input("CCO")
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class RuntimeResolutionError(RuntimeError):
    """Error de resolución de rutas para binarios y artefactos externos."""


SmilesInput = str | list[str]


@dataclass(frozen=True)
class RuntimePathsResolver:
    """Resuelve rutas de JRE/JAR para ejecución de herramientas externas."""

    runtime_tools_env_var: str = "RUNTIME_TOOLS_DIR"

    def get_runtime_tools_root(self) -> Path:
        """Obtiene la raíz de runtime tools considerando entorno y fallbacks."""
        configured_root: str = os.getenv(self.runtime_tools_env_var, "").strip()
        if configured_root != "":
            return Path(configured_root)

        repository_root_candidate: Path = Path(__file__).resolve().parents[2]
        repository_tools_candidate: Path = repository_root_candidate / "tools"
        if repository_tools_candidate.exists():
            return repository_tools_candidate

        return Path("/app/media/runtime-tools")

    def get_java8_bin_path(self) -> Path:
        """Retorna la ruta al binario java de JRE8 portable."""
        return self.get_runtime_tools_root() / "java" / "jre8" / "bin" / "java"

    def get_java21_bin_path(self) -> Path:
        """Retorna la ruta al binario java de JRE21 portable."""
        return self.get_runtime_tools_root() / "java" / "jre21" / "bin" / "java"

    def get_ambit_jar_path(self) -> Path:
        """Retorna la ruta al JAR de AMBIT SA."""
        return (
            self.get_runtime_tools_root()
            / "external"
            / "ambitSA"
            / "SyntheticAccessibilityCli.jar"
        )

    def assert_executable(self, executable_path: Path, label: str) -> None:
        """Valida que el ejecutable exista y tenga permisos de ejecución."""
        if not executable_path.exists() or not executable_path.is_file():
            raise RuntimeResolutionError(
                f"No existe {label} en {executable_path.as_posix()}"
            )
        if not os.access(executable_path, os.X_OK):
            raise RuntimeResolutionError(
                f"{label} no es ejecutable en {executable_path.as_posix()}"
            )

    def assert_file(self, file_path: Path, label: str) -> None:
        """Valida que el archivo exista y sea regular."""
        if not file_path.exists() or not file_path.is_file():
            raise RuntimeResolutionError(f"No existe {label} en {file_path.as_posix()}")


def normalize_smiles_input(smiles_input: SmilesInput) -> list[str]:
    """Normaliza entrada de SMILES (string o lista) a lista limpia no vacía."""
    if isinstance(smiles_input, str):
        normalized_value: str = smiles_input.strip()
        if normalized_value == "":
            raise ValueError("El SMILES no puede ser vacío.")
        return [normalized_value]

    cleaned_values: list[str] = []
    for raw_smiles in smiles_input:
        normalized_value = raw_smiles.strip()
        if normalized_value == "":
            continue
        cleaned_values.append(normalized_value)

    if len(cleaned_values) == 0:
        raise ValueError("La lista de SMILES no puede estar vacía.")

    return cleaned_values

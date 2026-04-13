"""_provisioning.py: Preparación automática de runtimes y artefactos externos.

Orquesta descarga/extracción de JREs y JARs, y ejecuta la validación final
de disponibilidad según modo estricto.
"""

from __future__ import annotations

import logging
import shutil
import tarfile
import tempfile
from pathlib import Path

from ._config import (
    get_ambit_jar_download_url,
    get_runtime_tools_root,
    is_runtime_tools_strict_check_enabled,
)
from ._download import _download_file_with_retry, _extract_tarfile_safely
from ._models import JAVA_RUNTIMES, JavaRuntimeDownloadSpec, RuntimeToolsError
from ._validation import (
    _is_executable_file,
    _is_valid_zip_file,
    assert_runtime_tools_ready,
)

logger = logging.getLogger(__name__)


def _prepare_java_runtime(
    runtime_tools_root: Path,
    runtime_spec: JavaRuntimeDownloadSpec,
) -> None:
    """Descarga y extrae una JRE portable si aún no está instalada."""
    runtime_directory: Path = runtime_tools_root / runtime_spec.target_subdir
    java_binary_path: Path = runtime_directory / "bin" / "java"

    if _is_executable_file(java_binary_path):
        logger.info(
            "Runtime %s ya presente en %s", runtime_spec.runtime_name, runtime_directory
        )
        return

    runtime_directory.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="java_runtime_extract_"
    ) as temporary_dir_raw:
        temporary_dir: Path = Path(temporary_dir_raw)
        tarball_path: Path = temporary_dir / f"{runtime_spec.runtime_name}.tar.gz"

        logger.info(
            "Descargando runtime %s desde %s",
            runtime_spec.runtime_name,
            runtime_spec.download_url,
        )
        _download_file_with_retry(runtime_spec.download_url, tarball_path)
        compressed_tarball_size_bytes: int = tarball_path.stat().st_size

        with tarfile.open(tarball_path, mode="r:gz") as archive_file:  # NOSONAR
            _extract_tarfile_safely(
                archive_file,
                temporary_dir,
                compressed_archive_size_bytes=compressed_tarball_size_bytes,
            )

        extracted_directories: list[Path] = [
            child_path for child_path in temporary_dir.iterdir() if child_path.is_dir()
        ]
        if len(extracted_directories) == 0:
            raise RuntimeToolsError(
                f"No se encontró carpeta extraída para {runtime_spec.runtime_name}."
            )

        extracted_directory: Path = extracted_directories[0]
        if runtime_directory.exists():
            shutil.rmtree(runtime_directory)
        shutil.move(extracted_directory.as_posix(), runtime_directory.as_posix())

    java_binary_path = runtime_directory / "bin" / "java"
    if not _is_executable_file(java_binary_path):
        raise RuntimeToolsError(
            "Runtime descargado pero java no quedó ejecutable en "
            f"{java_binary_path.as_posix()}"
        )


def _prepare_external_artifacts(
    runtime_tools_root: Path,
    *,
    strict_check: bool | None = None,
) -> None:
    """Descarga artefactos JAR externos obligatorios para el backend."""
    effective_strict_check: bool = (
        is_runtime_tools_strict_check_enabled()
        if strict_check is None
        else strict_check
    )
    ambit_jar_path: Path = (
        runtime_tools_root / "external" / "ambitSA" / "SyntheticAccessibilityCli.jar"
    )

    if not _is_valid_zip_file(ambit_jar_path):
        try:
            ambit_jar_download_url = get_ambit_jar_download_url()
        except RuntimeToolsError as exc:
            if not effective_strict_check:
                logger.warning(
                    "Se omite descarga automática de AMBIT en modo no estricto: %s",
                    exc,
                )
                return
            raise

        if ambit_jar_download_url is None:
            if not effective_strict_check:
                logger.warning(
                    "No se encontró SyntheticAccessibilityCli.jar ni mirror disponible. "
                    "El backend continuará en modo no estricto; las rutas que dependan "
                    "de AMBIT fallarán hasta instalar el JAR."
                )
                return

            raise RuntimeToolsError(
                "Falta SyntheticAccessibilityCli.jar y no hay un mirror utilizable configurado. "
                "Defina AMBIT_JAR_DOWNLOAD_URL con una URL HTTPS o use exactamente el mirror "
                "HTTP permitido de Uni Plovdiv, o copie el JAR manualmente en tools/external/ambitSA/."
            )

        logger.info("Descargando AMBIT SyntheticAccessibilityCli.jar")
        _download_file_with_retry(ambit_jar_download_url, ambit_jar_path)


def ensure_runtime_tools_ready(
    runtime_tools_root: Path | None = None,
    *,
    strict_check: bool | None = None,
) -> None:
    """Garantiza disponibilidad de runtime tools descargando faltantes cuando aplique."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    effective_strict_check: bool = (
        is_runtime_tools_strict_check_enabled()
        if strict_check is None
        else strict_check
    )
    resolved_root.mkdir(parents=True, exist_ok=True)

    for runtime_spec in JAVA_RUNTIMES:
        _prepare_java_runtime(resolved_root, runtime_spec)

    _prepare_external_artifacts(resolved_root, strict_check=effective_strict_check)
    assert_runtime_tools_ready(resolved_root, strict_check=effective_strict_check)

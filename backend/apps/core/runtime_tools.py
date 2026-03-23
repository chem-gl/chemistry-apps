"""runtime_tools.py: Gestión y validación de runtimes externos del backend.

Objetivo del archivo:
- Centralizar la verificación de binarios requeridos para herramientas externas
  (JREs portables y JARs científicos).
- Descargar y preparar automáticamente los artefactos faltantes cuando el
  entorno lo permite (por ejemplo, bootstrap de contenedor en producción).

Cómo se usa:
- `apps.py` ejecuta validación estricta durante el arranque de Django para
  bloquear el proceso cuando faltan dependencias críticas.
- `manage.py ensure_runtime_tools` invoca `ensure_runtime_tools_ready(...)`
  para descargar/verificar artefactos antes de iniciar servicios.
"""

from __future__ import annotations

import logging
import os
import shutil
import socket
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DOWNLOAD_MAX_ATTEMPTS: int = 5
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS: int = 900
DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES: int = 4 * 1024 * 1024


@dataclass(frozen=True)
class RuntimeToolRequirement:
    """Describe un artefacto obligatorio para ejecutar herramientas externas."""

    key: str
    relative_path: str
    must_be_executable: bool = False
    must_be_zip_file: bool = False


@dataclass(frozen=True)
class JavaRuntimeDownloadSpec:
    """Define URL y nombre de destino para descargar una JRE portable."""

    runtime_name: str
    target_subdir: str
    download_url: str


JAVA_RUNTIMES: tuple[JavaRuntimeDownloadSpec, ...] = (
    JavaRuntimeDownloadSpec(
        runtime_name="jre8",
        target_subdir="java/jre8",
        download_url=(
            "https://github.com/adoptium/temurin8-binaries/releases/download/"
            "jdk8u402-b06/OpenJDK8U-jre_x64_linux_hotspot_8u402b06.tar.gz"
        ),
    ),
    JavaRuntimeDownloadSpec(
        runtime_name="jre17",
        target_subdir="java/jre17",
        download_url=(
            "https://github.com/adoptium/temurin17-binaries/releases/download/"
            "jdk-17.0.10+7/OpenJDK17U-jre_x64_linux_hotspot_17.0.10_7.tar.gz"
        ),
    ),
    JavaRuntimeDownloadSpec(
        runtime_name="jre21",
        target_subdir="java/jre21",
        download_url=(
            "https://github.com/adoptium/temurin21-binaries/releases/download/"
            "jdk-21.0.2+13/OpenJDK21U-jre_x64_linux_hotspot_21.0.2_13.tar.gz"
        ),
    ),
)

AMBIT_JAR_URL: str = (
    "http://web.uni-plovdiv.bg/nick/ambit-tools/SyntheticAccessibilityCli.jar"
)

REQUIRED_RUNTIME_TOOLS: tuple[RuntimeToolRequirement, ...] = (
    RuntimeToolRequirement(
        key="java8",
        relative_path="java/jre8/bin/java",
        must_be_executable=True,
    ),
    RuntimeToolRequirement(
        key="java17",
        relative_path="java/jre17/bin/java",
        must_be_executable=True,
    ),
    RuntimeToolRequirement(
        key="java21",
        relative_path="java/jre21/bin/java",
        must_be_executable=True,
    ),
    RuntimeToolRequirement(
        key="ambit_jar",
        relative_path="external/ambitSA/SyntheticAccessibilityCli.jar",
        must_be_zip_file=True,
    ),
)


class RuntimeToolsError(RuntimeError):
    """Error de validación o preparación de artefactos de runtime."""


def _get_env_positive_int(variable_name: str, default_value: int) -> int:
    """Lee enteros positivos desde entorno con fallback seguro."""
    raw_value: str = os.getenv(variable_name, str(default_value)).strip()
    try:
        parsed_value: int = int(raw_value)
    except ValueError:
        return default_value

    if parsed_value <= 0:
        return default_value

    return parsed_value


def get_download_max_attempts() -> int:
    """Resuelve número máximo de reintentos para descargas remotas."""
    return _get_env_positive_int(
        "RUNTIME_TOOLS_DOWNLOAD_MAX_ATTEMPTS",
        DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
    )


def get_download_timeout_seconds() -> int:
    """Resuelve timeout de descarga en segundos para redes lentas."""
    return _get_env_positive_int(
        "RUNTIME_TOOLS_DOWNLOAD_TIMEOUT_SECONDS",
        DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    )


def get_runtime_tools_root() -> Path:
    """Resuelve la carpeta raíz de herramientas con prioridad por variable de entorno."""
    configured_root: str = os.getenv("RUNTIME_TOOLS_DIR", "").strip()
    if configured_root != "":
        return Path(configured_root)

    # Entorno local del repo (../tools).
    repository_root_candidate: Path = Path(__file__).resolve().parents[3]
    repository_tools_candidate: Path = repository_root_candidate / "tools"
    if repository_tools_candidate.exists():
        return repository_tools_candidate

    # Fallback para contenedores sin bind mount del repositorio completo.
    return Path("/app/media/runtime-tools")


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


def get_missing_runtime_files(runtime_tools_root: Path | None = None) -> list[str]:
    """Lista faltantes o inválidos de runtime tools requeridos por el backend."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    missing_messages: list[str] = []

    for requirement in REQUIRED_RUNTIME_TOOLS:
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


def assert_runtime_tools_ready(runtime_tools_root: Path | None = None) -> None:
    """Falla con excepción si falta algún artefacto de runtime obligatorio."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    missing_messages: list[str] = get_missing_runtime_files(resolved_root)

    if len(missing_messages) == 0:
        return

    details: str = "; ".join(missing_messages)
    raise RuntimeToolsError(
        "Faltan artefactos de runtime científico obligatorios. "
        f"RUNTIME_TOOLS_DIR={resolved_root.as_posix()} | Detalle: {details}"
    )


def _download_file_with_retry(
    url: str,
    destination_path: Path,
    *,
    max_attempts: int | None = None,
    timeout_seconds: float | None = None,
) -> None:
    """Descarga un archivo remoto con reintentos acotados y escritura atómica."""
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    effective_attempts: int = max_attempts or get_download_max_attempts()
    effective_timeout_seconds: float = float(
        timeout_seconds or get_download_timeout_seconds()
    )

    with tempfile.NamedTemporaryFile(
        mode="wb",
        delete=False,
        dir=destination_path.parent,
        prefix="download_",
    ) as temporary_file:
        temporary_path: Path = Path(temporary_file.name)

    last_error: Exception | None = None
    for attempt_number in range(1, effective_attempts + 1):
        try:
            request = urllib.request.Request(url=url, method="GET")
            with urllib.request.urlopen(
                request,
                timeout=effective_timeout_seconds,
            ) as response:
                with temporary_path.open("wb") as temporary_stream:
                    shutil.copyfileobj(
                        response,
                        temporary_stream,
                        length=DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES,
                    )

            temporary_path.replace(destination_path)
            return
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            TimeoutError,
            socket.timeout,
        ) as exc:
            last_error = exc
            logger.warning(
                "Descarga fallida (%s/%s) para %s (timeout=%ss): %s",
                attempt_number,
                effective_attempts,
                url,
                int(effective_timeout_seconds),
                exc,
            )

    if temporary_path.exists():
        temporary_path.unlink(missing_ok=True)

    raise RuntimeToolsError(
        "No fue posible descargar "
        f"{url} tras {effective_attempts} intentos (timeout={int(effective_timeout_seconds)}s): "
        f"{last_error}"
    )


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

        with tarfile.open(tarball_path, mode="r:gz") as archive_file:
            _extract_tarfile_safely(archive_file, temporary_dir)

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


def _extract_tarfile_safely(
    archive_file: tarfile.TarFile, destination_dir: Path
) -> None:
    """Extrae un tar.gz bloqueando rutas fuera del directorio destino."""
    destination_dir_resolved: Path = destination_dir.resolve()
    for member in archive_file.getmembers():
        target_path: Path = (destination_dir / member.name).resolve()
        if not str(target_path).startswith(str(destination_dir_resolved)):
            raise RuntimeToolsError(
                "El tarball contiene rutas inválidas fuera del destino de extracción."
            )

    archive_file.extractall(path=destination_dir)


def _prepare_external_artifacts(runtime_tools_root: Path) -> None:
    """Descarga artefactos JAR externos obligatorios para el backend."""
    ambit_jar_path: Path = (
        runtime_tools_root / "external" / "ambitSA" / "SyntheticAccessibilityCli.jar"
    )

    if not _is_valid_zip_file(ambit_jar_path):
        logger.info("Descargando AMBIT SyntheticAccessibilityCli.jar")
        _download_file_with_retry(AMBIT_JAR_URL, ambit_jar_path)


def ensure_runtime_tools_ready(runtime_tools_root: Path | None = None) -> None:
    """Garantiza disponibilidad de runtime tools descargando faltantes cuando aplique."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    resolved_root.mkdir(parents=True, exist_ok=True)

    for runtime_spec in JAVA_RUNTIMES:
        _prepare_java_runtime(resolved_root, runtime_spec)

    _prepare_external_artifacts(resolved_root)

    assert_runtime_tools_ready(resolved_root)

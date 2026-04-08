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
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DOWNLOAD_MAX_ATTEMPTS: int = 5
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS: int = 900
DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES: int = 4 * 1024 * 1024
DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO: float = 25.0
AMBIT_JAR_DOWNLOAD_URL_ENV_VAR: str = "AMBIT_JAR_DOWNLOAD_URL"


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


def get_ambit_jar_download_url() -> str | None:
    """Resuelve una URL HTTPS confiable para descargar el JAR de AMBIT.

    Se exige HTTPS porque el JAR se ejecuta localmente tras la descarga, por lo que
    aceptar una URL insegura expondría al backend a artefactos manipulados en tránsito.
    """
    configured_url: str = os.getenv(AMBIT_JAR_DOWNLOAD_URL_ENV_VAR, "").strip()
    if configured_url == "":
        return None

    parsed_url = urllib.parse.urlparse(configured_url)
    if parsed_url.scheme != "https":
        raise RuntimeToolsError(
            "La variable AMBIT_JAR_DOWNLOAD_URL debe usar HTTPS para descargar "
            "SyntheticAccessibilityCli.jar de forma segura."
        )

    if parsed_url.netloc == "":
        raise RuntimeToolsError(
            "La variable AMBIT_JAR_DOWNLOAD_URL no contiene un host válido."
        )

    return configured_url


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
        compressed_tarball_size_bytes: int = tarball_path.stat().st_size

        # Validación explícita previa de tamaño, cantidad de entradas y ratio para
        # evitar zip bombs antes de escribir cualquier archivo en disco.
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


def _validate_tar_entry_path(
    member: tarfile.TarInfo, destination_dir: Path, destination_dir_resolved: Path
) -> None:
    """Valida que la entrada del tar no intente salir del directorio destino (path traversal)."""
    target_path: Path = (destination_dir / member.name).resolve()
    inside_by_sep: bool = str(target_path).startswith(
        str(destination_dir_resolved) + os.sep
    )
    is_exact_destination: bool = str(target_path) == str(destination_dir_resolved)
    if not inside_by_sep and not is_exact_destination:
        raise RuntimeToolsError(
            "El tarball contiene rutas inválidas fuera del destino de extracción."
        )


def _validate_tar_entry_file_size(
    member: tarfile.TarInfo,
    total_size_bytes: int,
    max_total_size_bytes: int,
    max_compression_ratio: float | None = None,
) -> int:
    """Valida tamaño descomprimido acumulado por entrada de archivo. Retorna nuevo total."""
    del max_compression_ratio
    uncompressed_size: int = member.size
    new_total: int = total_size_bytes + uncompressed_size

    if new_total > max_total_size_bytes:
        raise RuntimeToolsError(
            f"El tarball supera el límite de {max_total_size_bytes // (1024**3)} GB "
            "descomprimidos (posible zip bomb)."
        )

    return new_total


def _validate_tar_archive_compression_ratio(
    archive_members: list[tarfile.TarInfo],
    compressed_archive_size_bytes: int,
    max_total_size_bytes: int,
    max_compression_ratio: float,
) -> None:
    """Valida el ratio global entre tamaño comprimido y descomprimido del tar."""
    total_uncompressed_size_bytes: int = sum(
        member.size for member in archive_members if member.isfile()
    )

    if total_uncompressed_size_bytes > max_total_size_bytes:
        raise RuntimeToolsError(
            f"El tarball supera el límite de {max_total_size_bytes // (1024**3)} GB "
            "descomprimidos (posible zip bomb)."
        )

    if compressed_archive_size_bytes <= 0:
        raise RuntimeToolsError(
            "El tarball descargado no tiene un tamaño comprimido válido."
        )

    compression_ratio: float = (
        total_uncompressed_size_bytes / compressed_archive_size_bytes
    )
    if compression_ratio > max_compression_ratio:
        raise RuntimeToolsError(
            "El tarball supera el ratio máximo de compresión permitido "
            f"({compression_ratio:.2f} > {max_compression_ratio:.2f})."
        )


def _extract_tarfile_safely(
    archive_file: tarfile.TarFile,
    destination_dir: Path,
    compressed_archive_size_bytes: int | None = None,
) -> None:
    """Extrae un tar.gz bloqueando rutas fuera del directorio destino y protegiendo contra zip bomb.

    Límites aplicados:
    - Máximo 10.000 entradas (protección contra inodes exhaustion).
    - Tamaño total descomprimido máximo 2 GB (protección contra data amplification).
    - Extracción individual por entrada para evitar descompresión masiva sin control.
    """
    # Límites de seguridad contra zip bomb (S5042)
    max_total_entries: int = 10_000
    max_total_size_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB
    max_compression_ratio: float = DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO

    destination_dir_resolved: Path = destination_dir.resolve()
    total_size_bytes: int = 0
    total_entries: int = 0
    archive_members: list[tarfile.TarInfo] = archive_file.getmembers()

    if len(archive_members) > max_total_entries:
        raise RuntimeToolsError(
            f"El tarball supera el límite de {max_total_entries} entradas (posible zip bomb)."
        )

    if compressed_archive_size_bytes is not None:
        _validate_tar_archive_compression_ratio(
            archive_members,
            compressed_archive_size_bytes,
            max_total_size_bytes,
            max_compression_ratio,
        )

    for member in archive_members:
        _validate_tar_entry_path(member, destination_dir, destination_dir_resolved)

        total_entries += 1
        if total_entries > max_total_entries:
            raise RuntimeToolsError(
                f"El tarball supera el límite de {max_total_entries} entradas (posible zip bomb)."
            )

        if member.isfile():
            total_size_bytes = _validate_tar_entry_file_size(
                member, total_size_bytes, max_total_size_bytes
            )

        _extract_tar_member_safely(archive_file, member, destination_dir)


def _extract_tar_member_safely(
    archive_file: tarfile.TarFile, member: tarfile.TarInfo, destination_dir: Path
) -> None:
    """Extrae una entrada permitiendo solo directorios, archivos y symlinks internos."""
    target_path: Path = destination_dir / member.name

    if member.isdir():
        target_path.mkdir(parents=True, exist_ok=True)
        target_path.chmod(0o755)
        return

    if member.isfile():
        extracted_file = archive_file.extractfile(member)
        if extracted_file is None:
            raise RuntimeToolsError(
                f"No fue posible leer la entrada {member.name!r} del tarball."
            )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        with extracted_file, target_path.open("wb") as destination_file:
            shutil.copyfileobj(
                extracted_file,
                destination_file,
                length=DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES,
            )

        target_mode: int = 0o755 if member.mode & 0o111 else 0o644
        target_path.chmod(target_mode)
        return

    if member.issym():
        target_path.parent.mkdir(parents=True, exist_ok=True)
        link_target: Path = Path(member.linkname)
        resolved_link_target: Path = (target_path.parent / link_target).resolve()
        destination_dir_resolved: Path = destination_dir.resolve()
        if (
            not str(resolved_link_target).startswith(
                str(destination_dir_resolved) + os.sep
            )
            and resolved_link_target != destination_dir_resolved
        ):
            raise RuntimeToolsError(
                "El tarball contiene enlaces simbólicos fuera del destino de extracción."
            )

        if target_path.exists() or target_path.is_symlink():
            target_path.unlink()

        os.symlink(member.linkname, target_path)
        return

    raise RuntimeToolsError(
        f"El tarball contiene una entrada no soportada: {member.name!r}."
    )


def _prepare_external_artifacts(runtime_tools_root: Path) -> None:
    """Descarga artefactos JAR externos obligatorios para el backend."""
    ambit_jar_path: Path = (
        runtime_tools_root / "external" / "ambitSA" / "SyntheticAccessibilityCli.jar"
    )

    if not _is_valid_zip_file(ambit_jar_path):
        ambit_jar_download_url = get_ambit_jar_download_url()
        if ambit_jar_download_url is None:
            raise RuntimeToolsError(
                "Falta SyntheticAccessibilityCli.jar y no hay una URL HTTPS configurada. "
                "Defina AMBIT_JAR_DOWNLOAD_URL con un mirror confiable o copie el JAR "
                "manualmente en tools/external/ambitSA/."
            )

        logger.info("Descargando AMBIT SyntheticAccessibilityCli.jar")
        _download_file_with_retry(ambit_jar_download_url, ambit_jar_path)


def ensure_runtime_tools_ready(runtime_tools_root: Path | None = None) -> None:
    """Garantiza disponibilidad de runtime tools descargando faltantes cuando aplique."""
    resolved_root: Path = runtime_tools_root or get_runtime_tools_root()
    resolved_root.mkdir(parents=True, exist_ok=True)

    for runtime_spec in JAVA_RUNTIMES:
        _prepare_java_runtime(resolved_root, runtime_spec)

    _prepare_external_artifacts(resolved_root)

    assert_runtime_tools_ready(resolved_root)

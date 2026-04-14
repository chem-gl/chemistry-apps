"""_models.py: Tipos y constantes de runtime tools.

Define dataclasses y configuraciones estáticas de artefactos requeridos
(JREs y JARs) para el bootstrap de herramientas científicas.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_DOWNLOAD_MAX_ATTEMPTS: int = 5
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS: int = 900
DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES: int = 4 * 1024 * 1024
DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO: float = 25.0
AMBIT_JAR_DOWNLOAD_URL_ENV_VAR: str = "AMBIT_JAR_DOWNLOAD_URL"
DEFAULT_AMBIT_JAR_DOWNLOAD_URL: str = "http://web.uni-plovdiv.bg/nick/ambit-tools/SyntheticAccessibilityCli.jar"  # NOSONAR


@dataclass(frozen=True)
class RuntimeToolRequirement:
    """Describe un artefacto obligatorio para ejecutar herramientas externas."""

    key: str
    relative_path: str
    must_be_executable: bool = False
    must_be_zip_file: bool = False
    optional_when_non_strict: bool = False


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
        optional_when_non_strict=True,
    ),
)


class RuntimeToolsError(RuntimeError):
    """Error de validación o preparación de artefactos de runtime."""

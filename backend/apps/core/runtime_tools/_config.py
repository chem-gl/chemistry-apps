"""_config.py: Resolución de configuración de runtime tools desde entorno.

Expone helpers para enteros positivos, modo estricto, URL de AMBIT y
resolución de la carpeta raíz de herramientas.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path

from ._models import (
    AMBIT_JAR_DOWNLOAD_URL_ENV_VAR,
    DEFAULT_AMBIT_JAR_DOWNLOAD_URL,
    DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
    DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    RuntimeToolsError,
)


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


def is_runtime_tools_strict_check_enabled() -> bool:
    """Indica si la validación de runtime tools debe ser bloqueante."""
    raw_value: str = os.getenv("RUNTIME_TOOLS_STRICT_CHECK", "").strip().lower()
    if raw_value == "":
        return True

    return raw_value in {"1", "true", "yes", "on"}


def get_ambit_jar_download_url() -> str | None:
    """Resuelve la URL autorizada para descargar el JAR de AMBIT."""
    configured_url: str = os.getenv(AMBIT_JAR_DOWNLOAD_URL_ENV_VAR, "").strip()
    effective_url: str = configured_url or DEFAULT_AMBIT_JAR_DOWNLOAD_URL

    parsed_url = urllib.parse.urlparse(effective_url)
    if parsed_url.netloc == "":
        raise RuntimeToolsError(
            "La variable AMBIT_JAR_DOWNLOAD_URL no contiene un host válido."
        )

    if parsed_url.scheme == "https" or effective_url == DEFAULT_AMBIT_JAR_DOWNLOAD_URL:
        return effective_url

    if parsed_url.scheme != "http":
        raise RuntimeToolsError(
            "La variable AMBIT_JAR_DOWNLOAD_URL debe usar HTTPS o coincidir con el "
            "mirror HTTP permitido de SyntheticAccessibilityCli.jar."
        )

    raise RuntimeToolsError(
        "La variable AMBIT_JAR_DOWNLOAD_URL debe usar HTTPS o coincidir exactamente "
        "con http://web.uni-plovdiv.bg/nick/ambit-tools/SyntheticAccessibilityCli.jar."
    )


def get_runtime_tools_root() -> Path:
    """Resuelve la carpeta raíz de herramientas con prioridad por variable de entorno."""
    configured_root: str = os.getenv("RUNTIME_TOOLS_DIR", "").strip()
    if configured_root != "":
        return Path(configured_root)

    repository_root_candidate: Path = Path(__file__).resolve().parents[4]
    repository_tools_candidate: Path = repository_root_candidate / "tools"
    if repository_tools_candidate.exists():
        return repository_tools_candidate

    return Path("/app/media/runtime-tools")

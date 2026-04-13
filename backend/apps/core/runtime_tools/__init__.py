"""runtime_tools/__init__.py: API pública de runtime tools modularizada.

Reexporta símbolos históricos para mantener compatibilidad con imports
existentes en tests, management commands y startup de Django.
"""

from __future__ import annotations

from ._config import (
    _get_env_positive_int,
    get_ambit_jar_download_url,
    get_download_max_attempts,
    get_download_timeout_seconds,
    get_runtime_tools_root,
    is_runtime_tools_strict_check_enabled,
)
from ._download import (
    _download_file_with_retry,
    _extract_tarfile_safely,
    _validate_tar_archive_compression_ratio,
    _validate_tar_entry_file_size,
    _validate_tar_entry_path,
)
from ._models import (
    AMBIT_JAR_DOWNLOAD_URL_ENV_VAR,
    DEFAULT_AMBIT_JAR_DOWNLOAD_URL,
    DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES,
    DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
    DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO,
    JAVA_RUNTIMES,
    REQUIRED_RUNTIME_TOOLS,
    JavaRuntimeDownloadSpec,
    RuntimeToolRequirement,
    RuntimeToolsError,
)
from ._provisioning import (
    _prepare_external_artifacts,
    _prepare_java_runtime,
    ensure_runtime_tools_ready,
)
from ._validation import (
    _is_executable_file,
    _is_valid_zip_file,
    _resolve_requirement_path,
    assert_runtime_tools_ready,
    get_missing_runtime_files,
)

__all__ = [
    "AMBIT_JAR_DOWNLOAD_URL_ENV_VAR",
    "DEFAULT_AMBIT_JAR_DOWNLOAD_URL",
    "DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES",
    "DEFAULT_DOWNLOAD_MAX_ATTEMPTS",
    "DEFAULT_DOWNLOAD_TIMEOUT_SECONDS",
    "DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO",
    "JAVA_RUNTIMES",
    "REQUIRED_RUNTIME_TOOLS",
    "JavaRuntimeDownloadSpec",
    "RuntimeToolRequirement",
    "RuntimeToolsError",
    "_download_file_with_retry",
    "_extract_tarfile_safely",
    "_get_env_positive_int",
    "_is_executable_file",
    "_is_valid_zip_file",
    "_prepare_external_artifacts",
    "_prepare_java_runtime",
    "_resolve_requirement_path",
    "_validate_tar_archive_compression_ratio",
    "_validate_tar_entry_file_size",
    "_validate_tar_entry_path",
    "assert_runtime_tools_ready",
    "ensure_runtime_tools_ready",
    "get_ambit_jar_download_url",
    "get_download_max_attempts",
    "get_download_timeout_seconds",
    "get_missing_runtime_files",
    "get_runtime_tools_root",
    "is_runtime_tools_strict_check_enabled",
]

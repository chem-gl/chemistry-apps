"""_download.py: Descarga y extracción segura de artefactos runtime.

Implementa descargas con reintentos y validaciones de seguridad para tar.gz,
incluyendo límites de entradas, tamaño y ratio de compresión.
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
from pathlib import Path

from ._config import get_download_max_attempts, get_download_timeout_seconds
from ._models import (
    DEFAULT_DOWNLOAD_CHUNK_SIZE_BYTES,
    DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO,
    RuntimeToolsError,
)

logger = logging.getLogger(__name__)


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


def _validate_tar_entry_path(
    member: tarfile.TarInfo,
    destination_dir: Path,
    destination_dir_resolved: Path,
) -> None:
    """Valida que la entrada del tar no intente salir del directorio destino."""
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
    """Valida tamaño descomprimido acumulado por entrada de archivo."""
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


def _extract_tar_member_safely(
    archive_file: tarfile.TarFile,
    member: tarfile.TarInfo,
    destination_dir: Path,
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


def _extract_tarfile_safely(
    archive_file: tarfile.TarFile,
    destination_dir: Path,
    compressed_archive_size_bytes: int | None = None,
) -> None:
    """Extrae un tar.gz con controles contra traversal y zip bomb."""
    max_total_entries: int = 10_000
    max_total_size_bytes: int = 2 * 1024 * 1024 * 1024
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
                member,
                total_size_bytes,
                max_total_size_bytes,
            )

        _extract_tar_member_safely(archive_file, member, destination_dir)

"""artifacts.py: Servicios de persistencia chunked para artefactos de entrada.

Objetivo del archivo:
- Persistir archivos de entrada en la base de datos para trazabilidad completa,
  reconstrucción exacta y reintentos reproducibles por job.
- Aplicar política de retención binaria:
    * Archivos ≤ ARTIFACT_INLINE_THRESHOLD_KB → permanentes en DB.
    * Archivos > umbral → expires_at asignado según ARTIFACT_LARGE_FILE_TTL_DAYS;
      la tarea periódica `purge_expired_artifact_chunks` elimina los chunks
      pero preserva metadatos y sha256 para trazabilidad.

Cómo se usa:
- Los routers de apps científicas llaman `ScientificInputArtifactStorageService`
  durante el create multipart.
- Los plugins operan con bytes reconstruidos desde DB, sin depender de filesystem.
- La tarea Celery llama `purge_expired_chunks()` cada noche.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from zipfile import ZIP_DEFLATED, ZipFile

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone

from .models import (
    ScientificJob,
    ScientificJobInputArtifact,
    ScientificJobInputArtifactChunk,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utilidades compartidas para multipart uploads (easy_rate, marcus, etc.)
# ---------------------------------------------------------------------------


def normalize_chunk_to_bytes(chunk: bytes | memoryview | str) -> bytes:
    """Normaliza chunk multipart en bytes para hashing consistente."""
    if isinstance(chunk, bytes):
        return chunk
    if isinstance(chunk, memoryview):
        return chunk.tobytes()
    return chunk.encode("utf-8")


def build_file_descriptor(
    field_name: str, uploaded_file: UploadedFile
) -> dict[str, str | int]:
    """Calcula descriptor estable (hash/tamaño/nombre) de un archivo cargado."""
    hasher = hashlib.sha256()
    total_size_bytes: int = 0

    for chunk in uploaded_file.chunks():
        chunk_bytes: bytes = normalize_chunk_to_bytes(chunk)
        hasher.update(chunk_bytes)
        total_size_bytes += len(chunk_bytes)

    uploaded_file.seek(0)

    return {
        "field_name": field_name,
        "original_filename": str(uploaded_file.name),
        "content_type": (
            str(uploaded_file.content_type)
            if uploaded_file.content_type is not None
            else "application/octet-stream"
        ),
        "sha256": hasher.hexdigest(),
        "size_bytes": total_size_bytes,
    }


# ---------------------------------------------------------------------------
# Política de retención de artefactos
# ---------------------------------------------------------------------------


def _get_inline_threshold_bytes() -> int:
    """Retorna el umbral en bytes bajo el cual un artefacto es permanente."""
    threshold_kb: int = int(getattr(settings, "ARTIFACT_INLINE_THRESHOLD_KB", 250))
    return threshold_kb * 1024


def _get_large_file_ttl_days() -> int:
    """Retorna el TTL en días para artefactos que superan el umbral."""
    return int(getattr(settings, "ARTIFACT_LARGE_FILE_TTL_DAYS", 30))


@dataclass(slots=True)
class ScientificInputArtifactStorageService:
    """Servicio de dominio para almacenar y reconstruir artefactos de entrada.

    Política de retención:
    - size_bytes ≤ threshold → expires_at=None  → chunks permanentes.
    - size_bytes > threshold → expires_at calculado según TTL_DAYS.
    - La tarea `purge_expired_artifact_chunks` ejecuta la purga en background.
    """

    chunk_size_bytes: int = 512 * 1024

    def store_uploaded_file(
        self,
        *,
        job: ScientificJob,
        uploaded_file: UploadedFile,
        field_name: str,
        role: str = "input",
    ) -> ScientificJobInputArtifact:
        """Guarda archivo multipart en chunks, asigna política de retención y retorna metadatos."""
        normalized_filename: str = self._normalize_filename(uploaded_file.name)
        content_type_value: str = (
            uploaded_file.content_type
            if uploaded_file.content_type
            else "application/octet-stream"
        )

        artifact: ScientificJobInputArtifact = (
            ScientificJobInputArtifact.objects.create(
                job=job,
                role=role,
                field_name=field_name,
                original_filename=normalized_filename,
                content_type=content_type_value,
                sha256="",
                size_bytes=0,
                chunk_count=0,
                expires_at=None,
                chunks_purged_at=None,
            )
        )

        hasher = hashlib.sha256()
        total_size_bytes: int = 0
        chunk_count: int = 0

        with transaction.atomic():
            for chunk in uploaded_file.chunks(self.chunk_size_bytes):
                chunk_bytes: bytes = self._normalize_chunk_to_bytes(chunk)
                hasher.update(chunk_bytes)
                total_size_bytes += len(chunk_bytes)

                ScientificJobInputArtifactChunk.objects.create(
                    artifact=artifact,
                    chunk_index=chunk_count,
                    chunk_data=chunk_bytes,
                )
                chunk_count += 1

            if chunk_count == 0:
                ScientificJobInputArtifactChunk.objects.create(
                    artifact=artifact,
                    chunk_index=0,
                    chunk_data=b"",
                )
                chunk_count = 1

            # Determinar política de retención según tamaño final del archivo.
            threshold_bytes: int = _get_inline_threshold_bytes()
            expires_at_value = None
            if total_size_bytes > threshold_bytes:
                ttl_days: int = _get_large_file_ttl_days()
                expires_at_value = timezone.now() + timedelta(days=ttl_days)
                logger.debug(
                    "Artefacto %s (%d bytes) supera umbral %d bytes; "
                    "expira en %d días: %s",
                    artifact.id,
                    total_size_bytes,
                    threshold_bytes,
                    ttl_days,
                    expires_at_value.isoformat(),
                )
            else:
                logger.debug(
                    "Artefacto %s (%d bytes) bajo umbral %d bytes; es permanente.",
                    artifact.id,
                    total_size_bytes,
                    threshold_bytes,
                )

            artifact.sha256 = hasher.hexdigest()
            artifact.size_bytes = total_size_bytes
            artifact.chunk_count = chunk_count
            artifact.expires_at = expires_at_value
            artifact.save(
                update_fields=[
                    "sha256",
                    "size_bytes",
                    "chunk_count",
                    "expires_at",
                    "updated_at",
                ]
            )

        return artifact

    def list_job_artifacts(
        self, *, job: ScientificJob
    ) -> list[ScientificJobInputArtifact]:
        """Lista artefactos de entrada asociados a un job ordenados por creación."""
        return list(
            ScientificJobInputArtifact.objects.filter(job=job)
            .order_by("created_at")
            .all()
        )

    def iter_artifact_bytes(
        self, *, artifact: ScientificJobInputArtifact
    ) -> Iterator[bytes]:
        """Itera bytes del artefacto en orden de chunk para streaming interno.

        Raises:
            ArtifactChunksPurgedError: si los chunks fueron eliminados por la
                política de retención de archivos grandes.
        """
        if artifact.chunks_purged_at is not None:
            raise ArtifactChunksPurgedError(
                artifact_id=str(artifact.id),
                field_name=artifact.field_name,
                purged_at=artifact.chunks_purged_at,
            )
        ordered_chunks = artifact.chunks.order_by("chunk_index").only("chunk_data")
        for chunk in ordered_chunks:
            raw_chunk = chunk.chunk_data
            if isinstance(raw_chunk, memoryview):
                yield raw_chunk.tobytes()
            else:
                yield bytes(raw_chunk)

    def read_artifact_bytes(self, *, artifact: ScientificJobInputArtifact) -> bytes:
        """Reconstruye el contenido completo de un artefacto en memoria.

        Raises:
            ArtifactChunksPurgedError: si los chunks fueron eliminados.
        """
        return b"".join(self.iter_artifact_bytes(artifact=artifact))

    def build_job_artifacts_zip_bytes(self, *, job: ScientificJob) -> bytes:
        """Empaqueta todos los artefactos del job en ZIP para export/reintento.

        Artefactos con chunks purgados se registran en el manifest con
        purged=true y se omite su binario del ZIP.
        """
        artifacts: list[ScientificJobInputArtifact] = self.list_job_artifacts(job=job)
        buffer = io.BytesIO()

        with ZipFile(buffer, mode="w", compression=ZIP_DEFLATED) as zip_file:
            manifest_payload: list[dict[str, object]] = []
            for artifact in artifacts:
                is_purged: bool = artifact.chunks_purged_at is not None
                manifest_entry: dict[str, object] = {
                    "artifact_id": str(artifact.id),
                    "field_name": artifact.field_name,
                    "filename": artifact.original_filename,
                    "content_type": artifact.content_type,
                    "sha256": artifact.sha256,
                    "size_bytes": int(artifact.size_bytes),
                    "chunk_count": int(artifact.chunk_count),
                    "purged": is_purged,
                    "purged_at": (
                        artifact.chunks_purged_at.isoformat()
                        if artifact.chunks_purged_at
                        else None
                    ),
                    "expires_at": (
                        artifact.expires_at.isoformat() if artifact.expires_at else None
                    ),
                }

                if not is_purged:
                    zip_entry_name: str = (
                        f"{artifact.field_name}/{artifact.id}_{artifact.original_filename}"
                    )
                    manifest_entry["zip_entry"] = zip_entry_name
                    with zip_file.open(zip_entry_name, mode="w") as zip_entry:
                        for chunk_bytes in self.iter_artifact_bytes(artifact=artifact):
                            zip_entry.write(chunk_bytes)
                else:
                    manifest_entry["zip_entry"] = None

                manifest_payload.append(manifest_entry)

            zip_file.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "job_id": str(job.id),
                        "plugin_name": job.plugin_name,
                        "artifact_count": len(artifacts),
                        "artifacts": manifest_payload,
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
            )

        return buffer.getvalue()

    def purge_expired_chunks(self) -> dict[str, int]:
        """Elimina chunks binarios de artefactos expirados preservando metadatos.

        Busca artefactos cuyo expires_at ya pasó y chunks_purged_at es None.
        Para cada uno: borra todos sus chunks en una transacción atómica y
        actualiza chunks_purged_at para evitar doble procesamiento.

        Retorna un dict con estadísticas de la purga para logging y monitoreo.
        """
        now = timezone.now()
        candidates = ScientificJobInputArtifact.objects.filter(
            expires_at__lte=now,
            chunks_purged_at__isnull=True,
        ).select_related("job")

        purged_count: int = 0
        bytes_freed: int = 0
        errors: int = 0

        for artifact in candidates:
            try:
                with transaction.atomic():
                    deleted_count, _ = ScientificJobInputArtifactChunk.objects.filter(
                        artifact=artifact
                    ).delete()
                    artifact.chunks_purged_at = now
                    artifact.save(update_fields=["chunks_purged_at", "updated_at"])

                purged_count += 1
                bytes_freed += int(artifact.size_bytes)
                logger.info(
                    "Chunks purgados para artefacto %s (job=%s, campo=%s, "
                    "tamaño=%d bytes, chunks=%d, expiró=%s)",
                    artifact.id,
                    artifact.job_id,
                    artifact.field_name,
                    artifact.size_bytes,
                    deleted_count,
                    artifact.expires_at.isoformat() if artifact.expires_at else "—",
                )
            except Exception as exc:
                errors += 1
                logger.error(
                    "Error al purgar chunks del artefacto %s: %s",
                    artifact.id,
                    exc,
                )

        logger.info(
            "Purga completada: %d artefactos, %d bytes liberados, %d errores.",
            purged_count,
            bytes_freed,
            errors,
        )
        return {
            "purged_artifacts": purged_count,
            "bytes_freed": bytes_freed,
            "errors": errors,
        }

    @staticmethod
    def _normalize_filename(filename: str) -> str:
        """Evita rutas del cliente y conserva solo nombre de archivo seguro."""
        normalized_path: str = filename.replace("\\", "/")
        candidate_name: str = normalized_path.rsplit("/", 1)[-1].strip()
        if candidate_name == "":
            return "uploaded-input.bin"
        return candidate_name

    @staticmethod
    def _normalize_chunk_to_bytes(chunk: bytes | memoryview | str) -> bytes:
        """Normaliza fragmentos de Django UploadedFile a bytes puros."""
        if isinstance(chunk, bytes):
            return chunk
        if isinstance(chunk, memoryview):
            return chunk.tobytes()
        return chunk.encode("utf-8")


class ArtifactChunksPurgedError(Exception):
    """Se lanza cuando los chunks binarios de un artefacto fueron purgados.

    Esto ocurre con archivos grandes (> ARTIFACT_INLINE_THRESHOLD_KB) cuyo
    TTL venció. Los metadatos del artefacto y el resultado del job se conservan.
    """

    def __init__(
        self,
        artifact_id: str,
        field_name: str,
        purged_at: object,
    ) -> None:
        self.artifact_id: str = artifact_id
        self.field_name: str = field_name
        self.purged_at = purged_at
        super().__init__(
            f"Los chunks del artefacto {artifact_id} (campo '{field_name}') "
            f"fueron purgados el {purged_at}. "
            "El resultado del job sigue disponible pero el archivo original no puede recuperarse."
        )

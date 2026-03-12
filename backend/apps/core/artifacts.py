"""artifacts.py: Servicios de persistencia chunked para artefactos de entrada.

Objetivo del archivo:
- Persistir archivos de entrada en la base de datos para trazabilidad completa,
  reconstrucción exacta y reintentos reproducibles por job.

Cómo se usa:
- Los routers de apps científicas llaman `ScientificInputArtifactStorageService`
  durante el create multipart.
- Los plugins operan con bytes reconstruidos desde DB, sin depender de filesystem.
"""

from __future__ import annotations

import hashlib
import io
import json
from collections.abc import Iterator
from dataclasses import dataclass
from zipfile import ZIP_DEFLATED, ZipFile

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction

from .models import (
    ScientificJob,
    ScientificJobInputArtifact,
    ScientificJobInputArtifactChunk,
)


@dataclass(slots=True)
class ScientificInputArtifactStorageService:
    """Servicio de dominio para almacenar y reconstruir artefactos de entrada."""

    chunk_size_bytes: int = 512 * 1024

    def store_uploaded_file(
        self,
        *,
        job: ScientificJob,
        uploaded_file: UploadedFile,
        field_name: str,
        role: str = "input",
    ) -> ScientificJobInputArtifact:
        """Guarda archivo multipart en chunks y retorna metadatos persistidos."""
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

            artifact.sha256 = hasher.hexdigest()
            artifact.size_bytes = total_size_bytes
            artifact.chunk_count = chunk_count
            artifact.save(
                update_fields=["sha256", "size_bytes", "chunk_count", "updated_at"]
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
        """Itera bytes del artefacto en orden de chunk para streaming interno."""
        ordered_chunks = artifact.chunks.order_by("chunk_index").only("chunk_data")
        for chunk in ordered_chunks:
            raw_chunk = chunk.chunk_data
            if isinstance(raw_chunk, memoryview):
                yield raw_chunk.tobytes()
            else:
                yield bytes(raw_chunk)

    def read_artifact_bytes(self, *, artifact: ScientificJobInputArtifact) -> bytes:
        """Reconstruye el contenido completo de un artefacto en memoria."""
        return b"".join(self.iter_artifact_bytes(artifact=artifact))

    def build_job_artifacts_zip_bytes(self, *, job: ScientificJob) -> bytes:
        """Empaqueta todos los artefactos del job en ZIP para export/reintento."""
        artifacts: list[ScientificJobInputArtifact] = self.list_job_artifacts(job=job)
        buffer = io.BytesIO()

        with ZipFile(buffer, mode="w", compression=ZIP_DEFLATED) as zip_file:
            manifest_payload: list[dict[str, str | int]] = []
            for artifact in artifacts:
                zip_entry_name: str = (
                    f"{artifact.field_name}/{artifact.id}_{artifact.original_filename}"
                )
                with zip_file.open(zip_entry_name, mode="w") as zip_entry:
                    for chunk_bytes in self.iter_artifact_bytes(artifact=artifact):
                        zip_entry.write(chunk_bytes)

                manifest_payload.append(
                    {
                        "artifact_id": str(artifact.id),
                        "field_name": artifact.field_name,
                        "filename": artifact.original_filename,
                        "content_type": artifact.content_type,
                        "sha256": artifact.sha256,
                        "size_bytes": int(artifact.size_bytes),
                        "chunk_count": int(artifact.chunk_count),
                        "zip_entry": zip_entry_name,
                    }
                )

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

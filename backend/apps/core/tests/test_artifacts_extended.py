"""test_artifacts_extended.py: Tests extendidos del servicio de artefactos.

Objetivo del archivo:
- Cubrir ScientificInputArtifactStorageService, normalize_chunk_to_bytes,
  build_file_descriptor, política de retención, purge_expired_chunks
  y ArtifactChunksPurgedError.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.test_artifacts_extended`.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.artifacts import (
    ArtifactChunksPurgedError,
    ScientificInputArtifactStorageService,
    build_file_descriptor,
    normalize_chunk_to_bytes,
)
from apps.core.models import (
    ScientificJob,
    ScientificJobInputArtifact,
    ScientificJobInputArtifactChunk,
)


def _make_job(plugin_name: str = "easy-rate") -> ScientificJob:
    """Crea job de prueba para asociar artefactos."""
    return ScientificJob.objects.create(
        plugin_name=plugin_name,
        algorithm_version="1.0.0",
        job_hash=f"artifact-test-hash-{plugin_name}",
        parameters={},
    )


def _make_uploaded_file(content: bytes, name: str = "test.mol") -> SimpleUploadedFile:
    """Crea archivo simulado para uploads multipart."""
    return SimpleUploadedFile(name, content, content_type="chemical/x-mdl-molfile")


class NormalizeChunkToBytesTests(TestCase):
    """Verifica normalización de tipos de chunk a bytes."""

    def test_bytes_passthrough(self) -> None:
        data = b"hello world"
        self.assertEqual(normalize_chunk_to_bytes(data), data)

    def test_memoryview_to_bytes(self) -> None:
        data = b"memview data"
        result = normalize_chunk_to_bytes(memoryview(data))
        self.assertEqual(result, data)

    def test_str_to_utf8_bytes(self) -> None:
        result = normalize_chunk_to_bytes("hola")
        self.assertEqual(result, b"hola")

    def test_unicode_str_to_bytes(self) -> None:
        result = normalize_chunk_to_bytes("áéíóú")
        self.assertEqual(result, "áéíóú".encode("utf-8"))


class BuildFileDescriptorTests(TestCase):
    """Verifica que build_file_descriptor retorna campos correctos."""

    def test_contains_all_required_keys(self) -> None:
        content = b"test content"
        uploaded = _make_uploaded_file(content, "molecule.mol")
        descriptor = build_file_descriptor("input_file", uploaded)
        for key in (
            "field_name",
            "original_filename",
            "content_type",
            "sha256",
            "size_bytes",
        ):
            self.assertIn(key, descriptor)

    def test_sha256_is_correct(self) -> None:
        content = b"deterministic content"
        uploaded = _make_uploaded_file(content, "test.mol")
        expected_sha256 = hashlib.sha256(content).hexdigest()
        descriptor = build_file_descriptor("file", uploaded)
        self.assertEqual(descriptor["sha256"], expected_sha256)

    def test_size_bytes_is_correct(self) -> None:
        content = b"exactly-20-bytesXXX"
        uploaded = _make_uploaded_file(content, "test.mol")
        descriptor = build_file_descriptor("file", uploaded)
        self.assertEqual(descriptor["size_bytes"], len(content))

    def test_field_name_propagated(self) -> None:
        uploaded = _make_uploaded_file(b"x", "f.mol")
        descriptor = build_file_descriptor("custom_field", uploaded)
        self.assertEqual(descriptor["field_name"], "custom_field")


class StoreUploadedFileSmallTests(TestCase):
    """Verifica almacenamiento de archivos pequeños (sin expiración)."""

    @override_settings(ARTIFACT_INLINE_THRESHOLD_KB=250)
    def test_small_file_has_no_expiry(self) -> None:
        job = _make_job()
        content = b"small file content under threshold"
        uploaded = _make_uploaded_file(content)
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        self.assertIsNone(artifact.expires_at)
        self.assertEqual(artifact.size_bytes, len(content))
        self.assertIsNotNone(artifact.sha256)
        self.assertNotEqual(artifact.sha256, "")

    def test_chunks_are_persisted(self) -> None:
        job = _make_job("easy-rate-chunks")
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="artifact-test-hash-easy-rate-chunks2"
        )
        content = b"content for chunk test"
        uploaded = _make_uploaded_file(content, "mol.mol")
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol"
        )
        chunk_count = ScientificJobInputArtifactChunk.objects.filter(
            artifact=artifact
        ).count()
        self.assertGreater(chunk_count, 0)

    def test_sha256_matches_content(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-test-sha256")
        content = b"verify my hash"
        expected = hashlib.sha256(content).hexdigest()
        uploaded = _make_uploaded_file(content)
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        self.assertEqual(artifact.sha256, expected)


class StoreUploadedFileLargeTests(TestCase):
    """Verifica que archivos grandes reciban fecha de expiración."""

    @override_settings(ARTIFACT_INLINE_THRESHOLD_KB=1, ARTIFACT_LARGE_FILE_TTL_DAYS=7)
    def test_large_file_gets_expiry(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-test-large")
        # 2 KB > 1 KB threshold
        large_content = b"X" * 2048
        uploaded = _make_uploaded_file(large_content)
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="big_file"
        )
        self.assertIsNotNone(artifact.expires_at)
        # Expiración debe ser en ~7 días
        delta = artifact.expires_at - timezone.now()
        self.assertGreater(delta.days, 5)
        self.assertLess(delta.days, 9)


class IterArtifactBytesTests(TestCase):
    """Verifica lectura de artefactos en streaming."""

    def test_reads_content_correctly(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-iter-hash")
        content = b"streaming content here"
        uploaded = _make_uploaded_file(content)
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        reconstructed = b"".join(svc.iter_artifact_bytes(artifact=artifact))
        self.assertEqual(reconstructed, content)

    def test_raises_when_chunks_purged(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-purged-hash")
        artifact = ScientificJobInputArtifact.objects.create(
            job=job,
            role="input",
            field_name="mol_file",
            original_filename="test.mol",
            content_type="chemical/x-mdl-molfile",
            sha256="abc123",
            size_bytes=100,
            chunk_count=0,
            expires_at=None,
            chunks_purged_at=timezone.now(),
        )
        svc = ScientificInputArtifactStorageService()
        with self.assertRaises(ArtifactChunksPurgedError):
            list(svc.iter_artifact_bytes(artifact=artifact))


class ReadArtifactBytesTests(TestCase):
    """Verifica reconstrucción completa en memoria."""

    def test_read_artifact_bytes_returns_full_content(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-read-hash")
        content = b"full content reconstruction"
        uploaded = _make_uploaded_file(content)
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        result = svc.read_artifact_bytes(artifact=artifact)
        self.assertEqual(result, content)


class ArtifactZipTests(TestCase):
    """Verifica empaquetado ZIP de artefactos de un job."""

    def test_zip_contains_manifest(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-zip-hash")
        content = b"molecule data"
        uploaded = _make_uploaded_file(content)
        svc = ScientificInputArtifactStorageService()
        svc.store_uploaded_file(job=job, uploaded_file=uploaded, field_name="mol_file")
        zip_bytes = svc.build_job_artifacts_zip_bytes(job=job)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            self.assertIn("manifest.json", zf.namelist())

    def test_zip_manifest_has_correct_job_id(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-zip-hash-2")
        uploaded = _make_uploaded_file(b"data")
        svc = ScientificInputArtifactStorageService()
        svc.store_uploaded_file(job=job, uploaded_file=uploaded, field_name="mol_file")
        zip_bytes = svc.build_job_artifacts_zip_bytes(job=job)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        self.assertEqual(manifest["job_id"], str(job.id))
        self.assertEqual(manifest["artifact_count"], 1)

    def test_zip_omits_binary_for_purged_artifact(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-zip-purged")
        purged_artifact = ScientificJobInputArtifact.objects.create(
            job=job,
            role="input",
            field_name="purged_field",
            original_filename="old.mol",
            content_type="chemical/x-mdl-molfile",
            sha256="deadbeef",
            size_bytes=1024,
            chunk_count=2,
            expires_at=timezone.now() - timedelta(days=10),
            chunks_purged_at=timezone.now() - timedelta(days=5),
        )
        svc = ScientificInputArtifactStorageService()
        zip_bytes = svc.build_job_artifacts_zip_bytes(job=job)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        artifact_entry = manifest["artifacts"][0]
        self.assertTrue(artifact_entry["purged"])
        self.assertIsNone(artifact_entry["zip_entry"])
        _ = purged_artifact  # confirmación implícita de que fue incluido en manifest


class PurgeExpiredChunksTests(TestCase):
    """Verifica la purga de chunks expirados."""

    def test_purges_expired_artifact(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-purge-run")
        uploaded = _make_uploaded_file(b"data to purge")
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        # Forzar expiración en el pasado
        past = timezone.now() - timedelta(days=1)
        ScientificJobInputArtifact.objects.filter(pk=artifact.pk).update(
            expires_at=past,
            chunks_purged_at=None,
        )
        result = svc.purge_expired_chunks()
        self.assertEqual(result["purged_artifacts"], 1)
        self.assertEqual(result["errors"], 0)
        remaining_chunks = ScientificJobInputArtifactChunk.objects.filter(
            artifact=artifact
        ).count()
        self.assertEqual(remaining_chunks, 0)
        artifact.refresh_from_db()
        self.assertIsNotNone(artifact.chunks_purged_at)

    def test_does_not_purge_non_expired(self) -> None:
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-no-purge")
        uploaded = _make_uploaded_file(b"keep this data")
        svc = ScientificInputArtifactStorageService()
        artifact = svc.store_uploaded_file(
            job=job, uploaded_file=uploaded, field_name="mol_file"
        )
        # expires_at en el futuro → no debe purgarse
        future = timezone.now() + timedelta(days=30)
        ScientificJobInputArtifact.objects.filter(pk=artifact.pk).update(
            expires_at=future,
            chunks_purged_at=None,
        )
        result = svc.purge_expired_chunks()
        self.assertEqual(result["purged_artifacts"], 0)

    def test_no_expiry_artifact_not_purged(self) -> None:
        """Artefactos permanentes (expires_at=None) nunca se purgan."""
        job = _make_job()
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="artifact-permanent")
        uploaded = _make_uploaded_file(b"permanent data")
        svc = ScientificInputArtifactStorageService()
        svc.store_uploaded_file(job=job, uploaded_file=uploaded, field_name="mol_file")
        result = svc.purge_expired_chunks()
        self.assertEqual(result["purged_artifacts"], 0)


class ArtifactChunksPurgedErrorTests(TestCase):
    """Verifica comportamiento de la excepción ArtifactChunksPurgedError."""

    def test_exception_attributes(self) -> None:
        purged_at = timezone.now()
        err = ArtifactChunksPurgedError(
            artifact_id="abc-123",
            field_name="mol_file",
            purged_at=purged_at,
        )
        self.assertEqual(err.artifact_id, "abc-123")
        self.assertEqual(err.field_name, "mol_file")
        self.assertEqual(err.purged_at, purged_at)
        self.assertIsInstance(str(err), str)
        self.assertGreater(len(str(err)), 0)

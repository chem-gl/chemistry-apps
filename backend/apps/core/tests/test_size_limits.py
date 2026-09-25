"""test_size_limits.py: Tests de los topes de tamaño del modo libre (fase 1).

Cubre:
- Cuerpo JSON por encima de ``MAX_PARAMETERS_BYTES`` → 413.
- Archivo de entrada por encima del tope del rol → 413 y sin artefactos huérfanos.
- Topes diferenciados: anónimo (estricto) vs registrado (holgado).
"""

from __future__ import annotations

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.easy_rate.definitions import APP_API_BASE_PATH as EASY_RATE_API_PATH
from apps.easy_rate.test_extended import _build_valid_multipart_payload

from ..artifacts import ArtifactTooLargeError, ScientificInputArtifactStorageService
from ..models import ScientificJob, ScientificJobInputArtifact
from ..test_utils import build_authenticated_api_client

PUBLIC_EASY_RATE_URL = "/api/public/easy-rate/jobs/"
PUBLIC_MOLAR_URL = "/api/public/molar-fractions/jobs/"
PRIVATE_MOLAR_URL = "/api/molar-fractions/jobs/"

OVERSIZED_MOLAR_PAYLOAD: dict[str, object] = {
    "version": "1.0.0",
    "pka_values": [4.75, 7.0, 9.5, 2.2, 12.3, 3.3, 8.8, 6.6, 5.5, 10.1],
    "initial_charge": -1,
    "label": "AcetylcholineCationLongLabel",
    "ph_mode": "single",
    "ph_value": 7.4,
    "padding": "x" * 1024,
}

SMALL_UPLOAD_BYTES = 64
TINY_LIMIT_BYTES = 16


def _create_job(**overrides: object) -> ScientificJob:
    """Crea un job mínimo persistido para pruebas de límites de subida."""
    defaults: dict[str, object] = {
        "job_hash": "c" * 64,
        "plugin_name": "easy-rate",
        "algorithm_version": "1.0.0",
        "status": "pending",
        "parameters": {},
    }
    defaults.update(overrides)
    return ScientificJob.objects.create(**defaults)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class PayloadTooLargeTests(TestCase):
    """Verifica que un cuerpo JSON excesivo responde 413 y no 400."""

    def setUp(self) -> None:
        cache.clear()
        self.client = build_authenticated_api_client()

    def tearDown(self) -> None:
        cache.clear()

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=512)
    def test_oversized_json_body_returns_413(self) -> None:
        response = self.client.post(
            PRIVATE_MOLAR_URL, OVERSIZED_MOLAR_PAYLOAD, format="json"
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("detail", response.data)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=512)
    def test_oversized_json_body_on_public_route_returns_413(self) -> None:
        response = self.client.post(
            PUBLIC_MOLAR_URL, OVERSIZED_MOLAR_PAYLOAD, format="json"
        )

        self.assertEqual(response.status_code, 413)

    def test_payload_within_limit_is_not_rejected_for_size(self) -> None:
        with patch("apps.molar_fractions.routers.dispatch_scientific_job", return_value=True):
            response = self.client.post(
                PRIVATE_MOLAR_URL,
                {
                    "version": "1.0.0",
                    "pka_values": [4.75],
                    "initial_charge": -1,
                    "label": "Ac",
                    "ph_mode": "single",
                    "ph_value": 7.4,
                },
                format="json",
            )

        self.assertEqual(response.status_code, 201)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class ArtifactSizeLimitTests(TestCase):
    """Verifica los topes de archivo por rol (anónimo vs registrado)."""

    def setUp(self) -> None:
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    @override_settings(ANONYMOUS_MAX_UPLOAD_BYTES=TINY_LIMIT_BYTES)
    def test_service_rejects_oversized_artifact_and_rolls_back(self) -> None:
        job = _create_job()

        with self.assertRaises(ArtifactTooLargeError):
            ScientificInputArtifactStorageService().store_uploaded_file(
                job=job,
                uploaded_file=SimpleUploadedFile(
                    "big.log", b"x" * SMALL_UPLOAD_BYTES, content_type="text/plain"
                ),
                field_name="reactant_1_file",
            )

        self.assertEqual(
            ScientificJobInputArtifact.objects.filter(job=job).count(),
            0,
        )

    @override_settings(
        ANONYMOUS_MAX_UPLOAD_BYTES=TINY_LIMIT_BYTES,
        REGISTERED_MAX_UPLOAD_BYTES=1024,
    )
    def test_registered_job_uses_the_more_permissive_limit(self) -> None:
        job = _create_job(owner=build_authenticated_api_client_user())

        artifact = ScientificInputArtifactStorageService().store_uploaded_file(
            job=job,
            uploaded_file=SimpleUploadedFile(
                "ok.log", b"x" * SMALL_UPLOAD_BYTES, content_type="text/plain"
            ),
            field_name="reactant_1_file",
        )

        self.assertEqual(artifact.size_bytes, SMALL_UPLOAD_BYTES)

    @override_settings(REGISTERED_MAX_UPLOAD_BYTES=TINY_LIMIT_BYTES)
    def test_private_route_returns_413_for_oversized_upload(self) -> None:
        client = build_authenticated_api_client()

        with patch("apps.core.base_router.dispatch_scientific_job", return_value=True):
            response = client.post(
                EASY_RATE_API_PATH, _build_valid_multipart_payload(), format="multipart"
            )

        self.assertEqual(response.status_code, 413)
        self.assertIn("supera", response.data["detail"])

    @override_settings(ANONYMOUS_MAX_UPLOAD_BYTES=TINY_LIMIT_BYTES)
    def test_public_route_returns_413_for_oversized_upload(self) -> None:
        with patch("apps.core.base_router.dispatch_scientific_job", return_value=True):
            response = self.client.post(
                PUBLIC_EASY_RATE_URL,
                _build_valid_multipart_payload(),
                format="multipart",
            )

        self.assertEqual(response.status_code, 413)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class UploadHandlerTests(TestCase):
    """Verifica el corte temprano del multipart (evita el DoS por disco)."""

    def setUp(self) -> None:
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    @override_settings(
        ANONYMOUS_MAX_UPLOAD_BYTES=TINY_LIMIT_BYTES,
        FILE_UPLOAD_MAX_MEMORY_SIZE=1,
    )
    def test_upload_is_cut_while_receiving_the_body(self) -> None:
        """Con archivos que exceden el umbral de memoria, corta el handler."""
        with patch("apps.core.base_router.dispatch_scientific_job", return_value=True):
            response = self.client.post(
                PUBLIC_EASY_RATE_URL,
                _build_valid_multipart_payload(),
                format="multipart",
            )

        self.assertEqual(response.status_code, 413)


def build_authenticated_api_client_user() -> object:
    """Crea (y retorna) el usuario de pruebas del cliente autenticado."""
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="size-limit-owner")

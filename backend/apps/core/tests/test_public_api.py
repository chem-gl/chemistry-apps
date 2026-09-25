"""test_public_api.py: Tests de las rutas públicas (apps libres sin login).

Cubre el contrato del modo libre: despacho anónimo con TTL, acceso por
capability URL, superficie mínima de endpoints y límite de tasa en el despacho.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from django.utils import timezone

from ..models import ScientificJob

MOLAR_CREATE_URL = "/api/public/molar-fractions/jobs/"
PUBLIC_CATALOG_URL = "/api/public/catalog/"
MOLAR_PAYLOAD: dict[str, object] = {
    "version": "1.0.0",
    "pka_values": [4.75],
    "initial_charge": -1,
    "label": "Ac",
    "ph_mode": "single",
    "ph_value": 7.4,
}

DISPATCH_PATCH_TARGET = "apps.molar_fractions.routers.dispatch_scientific_job"


def _create_molar_job(**overrides: object) -> ScientificJob:
    """Crea un job de molar_fractions persistido para pruebas de acceso."""
    defaults: dict[str, object] = {
        "job_hash": uuid4().hex,
        "plugin_name": "molar-fractions",
        "algorithm_version": "1.0.0",
        "status": "pending",
        "results": None,
        "parameters": {
            "pka_values": [4.75],
            "initial_charge": -1,
            "label": "Ac",
            "ph_mode": "single",
            "ph_value": 7.4,
        },
    }
    defaults.update(overrides)
    return ScientificJob.objects.create(**defaults)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class PublicDispatchTests(TestCase):
    """Verifica la creación de jobs anónimos desde la ruta pública."""

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    @patch(DISPATCH_PATCH_TARGET, return_value=True)
    def test_dispatch_without_login_creates_anonymous_job(self, _mock_dispatch) -> None:
        response = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 201)
        job = ScientificJob.objects.get(pk=response.data["id"])
        self.assertIsNone(job.owner_id)
        self.assertIsNone(job.group_id)
        self.assertIsNotNone(job.expires_at)
        self.assertGreater(job.expires_at, timezone.now())

    @patch(DISPATCH_PATCH_TARGET, return_value=True)
    def test_authenticated_actor_still_creates_anonymous_job(
        self, _mock_dispatch
    ) -> None:
        user = get_user_model().objects.create_user(username="public-token-owner")
        self.client.force_authenticate(user=user)

        response = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 201)
        job = ScientificJob.objects.get(pk=response.data["id"])
        self.assertIsNone(job.owner_id)

    def test_invalid_payload_is_rejected(self) -> None:
        response = self.client.post(
            MOLAR_CREATE_URL, {"ph_mode": "single", "pka_values": []}, format="json"
        )

        self.assertEqual(response.status_code, 400)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class PublicRetrieveTests(TestCase):
    """Verifica el acceso por capability URL a jobs anónimos."""

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    def test_retrieve_fresh_anonymous_job_by_uuid(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.data["id"]), str(job.id))

    def test_retrieve_does_not_expose_owned_jobs(self) -> None:
        user = get_user_model().objects.create_user(username="public-owned-job")
        owned_job = _create_molar_job(owner=user)

        response = self.client.get(f"{MOLAR_CREATE_URL}{owned_job.id}/")

        self.assertEqual(response.status_code, 404)

    def test_retrieve_expired_anonymous_job_returns_404(self) -> None:
        expired_job = _create_molar_job(
            expires_at=timezone.now() - timedelta(minutes=1)
        )

        response = self.client.get(f"{MOLAR_CREATE_URL}{expired_job.id}/")

        self.assertEqual(response.status_code, 404)

    def test_retrieve_unknown_uuid_returns_404(self) -> None:
        response = self.client.get(f"{MOLAR_CREATE_URL}{uuid4()}/")

        self.assertEqual(response.status_code, 404)


# El modo abierto se fuerza aquí: estos tests verifican la superficie pública,
# no el interruptor global (con `OPEN_MODE_ENABLED=False` del `.env` local todo
# lo público respondería 404).
@override_settings(OPEN_MODE_ENABLED=True)
class PublicSurfaceTests(TestCase):
    """Verifica el contrato del modo abierto sobre la superficie pública.

    Decisión de producto: el modo libre publica todos los reportes del job
    anónimo (el UUID es la capability URL y el aviso de privacidad ya declara
    que los parámetros no son privados). La escritura del catálogo Smile-it
    sigue detrás de cuenta.
    """

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    def test_listing_is_not_exposed(self) -> None:
        _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(MOLAR_CREATE_URL)

        # La ruta existe solo para POST; GET no lista ningún job.
        self.assertEqual(response.status_code, 405)

    def test_log_report_is_available_for_anonymous_job(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-log/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", response["Content-Type"])

    def test_inputs_report_is_reachable_and_reports_missing_artifacts(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-inputs/")

        # La ruta es pública; el 409 explica que el job no tiene artefactos.
        self.assertEqual(response.status_code, 409)

    def test_error_report_is_reachable_for_completed_job(self) -> None:
        job = _create_molar_job(
            status="completed", expires_at=timezone.now() + timedelta(hours=1)
        )

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-error/")

        self.assertEqual(response.status_code, 409)

    def test_reports_do_not_expose_owned_jobs(self) -> None:
        user = get_user_model().objects.create_user(username="public-reports-owner")
        owned_job = _create_molar_job(owner=user, status="completed")

        for report_action in ("report-csv", "report-log", "report-error"):
            with self.subTest(report_action=report_action):
                response = self.client.get(
                    f"{MOLAR_CREATE_URL}{owned_job.id}/{report_action}/"
                )
                self.assertEqual(response.status_code, 404)

    def test_smileit_reference_catalog_is_public_and_read_only(self) -> None:
        catalog_url = "/api/public/smileit/jobs/catalog/"

        get_response = self.client.get(catalog_url)
        post_response = self.client.post(catalog_url, {}, format="json")

        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(post_response.status_code, 405)

    def test_public_catalog_endpoint_describes_open_mode(self) -> None:
        response = self.client.get("/api/public/catalog/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["mode"], "open")
        self.assertEqual(len(response.data["apps"]), 7)
        self.assertIn("job_ttl_hours", response.data["limits"])
        self.assertIn("max_upload_bytes", response.data["limits"])

    def test_csv_report_is_available_for_completed_job(self) -> None:
        job = _create_molar_job(
            status="completed",
            expires_at=timezone.now() + timedelta(hours=1),
            results={
                "species_labels": ["H2A", "HA", "A"],
                "rows": [
                    {"ph": 7.0, "fractions": [0.1, 0.8, 0.1], "sum_fraction": 1.0},
                ],
                "metadata": {
                    "pka_values": [4.75],
                    "initial_charge": -1,
                    "label": "Ac",
                    "ph_mode": "single",
                    "ph_min": 7.4,
                    "ph_max": 7.4,
                    "ph_step": 1.0,
                    "total_species": 3,
                    "total_points": 1,
                },
            },
        )

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])


@override_settings(
    OPEN_MODE_ENABLED=True,
    REST_FRAMEWORK={
        "DEFAULT_THROTTLE_RATES": {
            "public-dispatch": "2/hour",
            "public-read": "2/hour",
            "registered-dispatch": "600/hour",
        }
    }
)
class PublicThrottleTests(TestCase):
    """Verifica los topes del modo libre: despacho, lectura y polling libre."""

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    @patch(DISPATCH_PATCH_TARGET, return_value=True)
    def test_dispatch_is_throttled_by_ip(self, _mock_dispatch) -> None:
        first = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")
        second = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")
        third = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(third.status_code, 429)

    def test_retrieve_is_not_throttled_to_allow_polling(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))
        retrieve_url = f"{MOLAR_CREATE_URL}{job.id}/"

        for _ in range(5):
            response = self.client.get(retrieve_url)
            self.assertEqual(response.status_code, 200)

    def test_heavy_reports_are_throttled_by_ip(self) -> None:
        job = _create_molar_job(
            status="completed", expires_at=timezone.now() + timedelta(hours=1)
        )
        report_url = f"{MOLAR_CREATE_URL}{job.id}/report-log/"

        first = self.client.get(report_url)
        second = self.client.get(report_url)
        third = self.client.get(report_url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)


@override_settings(
    OPEN_MODE_ENABLED=True,
    REST_FRAMEWORK={
        "DEFAULT_THROTTLE_RATES": {
            "public-dispatch": "60/hour",
            "public-read": "1/hour",
            "registered-dispatch": "600/hour",
        }
    },
)
class PublicCatalogCacheTests(TestCase):
    """El catálogo público no consume la cuota `public-read` y se cachea.

    Causa raíz (429 en producción): el SPA pide el catálogo en cada carga y,
    con IPs compartidas (NAT/aulas), esas lecturas baratas agotaban la cuota
    de `public-read` y dejaban al SPA sin poder resolver el modo. El catálogo
    queda exento de throttle y lleva `Cache-Control` para que el navegador no
    lo repita en cada navegación.
    """

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    def test_catalog_ignores_public_read_quota(self) -> None:
        # Con `public-read` a 1/hour, dos peticiones seguidas deben responder
        # 200: si el catálogo consumiera la cuota, la segunda sería 429.
        first = self.client.get(PUBLIC_CATALOG_URL)
        second = self.client.get(PUBLIC_CATALOG_URL)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

    def test_catalog_sets_http_cache_header(self) -> None:
        response = self.client.get(PUBLIC_CATALOG_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "public, max-age=300")

    def test_heavy_reads_still_consume_public_read_quota(self) -> None:
        # Regresión: eximir el catálogo no exime las lecturas costosas reales.
        job = _create_molar_job(
            status="completed", expires_at=timezone.now() + timedelta(hours=1)
        )
        report_url = f"{MOLAR_CREATE_URL}{job.id}/report-log/"

        self.assertEqual(self.client.get(report_url).status_code, 200)
        self.assertEqual(self.client.get(report_url).status_code, 429)


@override_settings(OPEN_MODE_ENABLED=False)
class PublicDisabledModeTests(TestCase):
    """Con el modo libre apagado, la superficie pública no existe (404)."""

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def tearDown(self) -> None:
        cache.clear()

    def test_dispatch_returns_404_when_open_mode_is_disabled(self) -> None:
        response = self.client.post(MOLAR_CREATE_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 404)

    def test_retrieve_returns_404_when_open_mode_is_disabled(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/")

        self.assertEqual(response.status_code, 404)

    def test_catalog_reports_closed_mode_without_apps(self) -> None:
        response = self.client.get("/api/public/catalog/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["mode"], "closed")
        self.assertEqual(response.data["apps"], [])


class PublicOpenApiContractTests(TestCase):
    """El modo libre necesita request/response declarados para generar cliente.

    Sin estas anotaciones el cliente OpenAPI produce operaciones sin cuerpo y
    el frontend no puede despachar ni tipar el resultado anónimo.
    """

    PUBLIC_JOB_PATHS: tuple[str, ...] = (
        "/api/public/molar-fractions/jobs/",
        "/api/public/tunnel/jobs/",
        "/api/public/easy-rate/jobs/",
        "/api/public/marcus/jobs/",
        "/api/public/smileit/jobs/",
        "/api/public/sa-score/jobs/",
        "/api/public/toxicity-properties/jobs/",
    )

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        from drf_spectacular.generators import SchemaGenerator

        cls.schema: dict[str, object] = SchemaGenerator().get_schema(
            request=None, public=True
        )

    def test_public_job_creation_declares_request_and_response(self) -> None:
        paths = self.schema["paths"]  # type: ignore[index]

        for path in self.PUBLIC_JOB_PATHS:
            with self.subTest(path=path):
                operation = paths[path]["post"]
                self.assertIn("requestBody", operation)
                self.assertIn("201", operation["responses"])

    def test_public_retrieve_declares_response_schema(self) -> None:
        paths = self.schema["paths"]  # type: ignore[index]

        for path in self.PUBLIC_JOB_PATHS:
            with self.subTest(path=path):
                operation = paths[f"{path}{{id}}/"]["get"]
                success_response = operation["responses"]["200"]
                self.assertIn("content", success_response)

    def test_public_catalog_is_in_the_schema(self) -> None:
        paths = self.schema["paths"]  # type: ignore[index]

        self.assertIn("/api/public/catalog/", paths)
        self.assertIn("get", paths["/api/public/catalog/"])

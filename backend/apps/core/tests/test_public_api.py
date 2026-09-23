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


class PublicSurfaceTests(TestCase):
    """Verifica que la superficie pública no expone acciones extra."""

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

    def test_log_report_is_not_exposed(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-log/")

        self.assertEqual(response.status_code, 404)

    def test_inputs_report_is_not_exposed(self) -> None:
        job = _create_molar_job(expires_at=timezone.now() + timedelta(hours=1))

        response = self.client.get(f"{MOLAR_CREATE_URL}{job.id}/report-inputs/")

        self.assertEqual(response.status_code, 404)

    def test_smileit_catalog_actions_are_not_exposed(self) -> None:
        response = self.client.get("/api/public/smileit/jobs/catalog/")

        self.assertEqual(response.status_code, 404)

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
    REST_FRAMEWORK={
        "DEFAULT_THROTTLE_RATES": {
            "public-dispatch": "2/hour",
            "registered-dispatch": "600/hour",
        }
    }
)
class PublicThrottleTests(TestCase):
    """Verifica el límite de tasa solo en el despacho público."""

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

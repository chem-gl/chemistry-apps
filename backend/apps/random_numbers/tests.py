"""tests.py: Pruebas de contrato y dominio para la app random_numbers."""

from __future__ import annotations

from unittest.mock import Mock, patch
from urllib.error import URLError

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService
from apps.core.types import JSONMap
from django.test import TestCase
from rest_framework.test import APIClient

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


class RandomNumbersContractApiTests(TestCase):
    """Valida request/response y ejecución para endpoints random_numbers."""

    def setUp(self) -> None:
        self.client = APIClient()

    @patch("apps.random_numbers.plugin.sleep")
    @patch("apps.random_numbers.plugin.urlopen")
    def test_create_and_retrieve_random_numbers_job(
        self,
        urlopen_mock: Mock,
        sleep_mock: Mock,
    ) -> None:
        del sleep_mock
        mocked_response = Mock()
        mocked_response.read.return_value = b"seed-data"
        urlopen_mock.return_value.__enter__.return_value = mocked_response

        request_payload: JSONMap = {
            "version": "1.0.0",
            "seed_url": "https://example.com/seed.txt",
            "numbers_per_batch": 5,
            "interval_seconds": 1,
            "total_numbers": 12,
        }

        with patch(
            "apps.random_numbers.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(create_response.data["status"], "pending")

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")
        self.assertEqual(
            len(retrieve_response.data["results"]["generated_numbers"]),
            12,
        )
        self.assertEqual(
            retrieve_response.data["results"]["metadata"]["total_numbers"],
            12,
        )

    def test_create_random_numbers_job_rejects_invalid_payload(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "seed_url": "not-a-url",
            "numbers_per_batch": 0,
            "interval_seconds": -2,
            "total_numbers": 0,
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("seed_url", response.data)
        self.assertIn("numbers_per_batch", response.data)
        self.assertIn("interval_seconds", response.data)
        self.assertIn("total_numbers", response.data)

    @patch("apps.random_numbers.plugin.sleep")
    @patch("apps.random_numbers.plugin.urlopen")
    def test_random_numbers_job_updates_progress_incrementally(
        self,
        urlopen_mock: Mock,
        sleep_mock: Mock,
    ) -> None:
        del sleep_mock
        mocked_response = Mock()
        mocked_response.read.return_value = b"seed-data"
        urlopen_mock.return_value.__enter__.return_value = mocked_response

        job: ScientificJob = JobService.create_job(
            plugin_name=PLUGIN_NAME,
            version="1.0.0",
            parameters={
                "seed_url": "https://example.com/seed.txt",
                "numbers_per_batch": 3,
                "interval_seconds": 1,
                "total_numbers": 9,
            },
        )

        JobService.run_job(str(job.id))
        job.refresh_from_db()

        self.assertEqual(job.status, "completed")
        self.assertEqual(job.progress_stage, "completed")
        self.assertEqual(job.progress_percentage, 100)
        self.assertGreaterEqual(job.progress_event_index, 4)

    @patch("apps.random_numbers.plugin.sleep")
    @patch("apps.random_numbers.plugin.urlopen")
    def test_random_numbers_job_uses_seed_url_fallback_when_remote_fetch_fails(
        self,
        urlopen_mock: Mock,
        sleep_mock: Mock,
    ) -> None:
        del sleep_mock
        urlopen_mock.side_effect = URLError("SSL certificate verify failed")

        job: ScientificJob = JobService.create_job(
            plugin_name=PLUGIN_NAME,
            version="1.0.0",
            parameters={
                "seed_url": "https://example.com/seed.txt",
                "numbers_per_batch": 2,
                "interval_seconds": 1,
                "total_numbers": 4,
            },
        )

        JobService.run_job(str(job.id))
        job.refresh_from_db()

        self.assertEqual(job.status, "completed")
        self.assertIsNotNone(job.results)
        self.assertEqual(len(job.results["generated_numbers"]), 4)
        self.assertEqual(len(job.results["metadata"]["seed_digest"]), 64)

    @patch("apps.random_numbers.plugin.sleep")
    @patch("apps.random_numbers.plugin.urlopen")
    def test_random_numbers_job_persists_runtime_and_plugin_logs(
        self,
        urlopen_mock: Mock,
        sleep_mock: Mock,
    ) -> None:
        del sleep_mock
        mocked_response = Mock()
        mocked_response.read.return_value = b"seed-data"
        urlopen_mock.return_value.__enter__.return_value = mocked_response

        job: ScientificJob = JobService.create_job(
            plugin_name=PLUGIN_NAME,
            version="1.0.0",
            parameters={
                "seed_url": "https://example.com/seed.txt",
                "numbers_per_batch": 2,
                "interval_seconds": 1,
                "total_numbers": 4,
            },
        )

        JobService.run_job(str(job.id))

        job_logs = ScientificJobLogEvent.objects.filter(job=job).order_by("event_index")
        self.assertGreaterEqual(job_logs.count(), 4)
        sources: set[str] = {str(item.source) for item in job_logs}
        self.assertIn("core.runtime", sources)
        self.assertIn("random_numbers.plugin", sources)

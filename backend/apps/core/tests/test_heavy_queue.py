"""test_heavy_queue.py: Ruteo de plugins pesados a una cola Celery dedicada.

El despliegue actual no cambia de comportamiento (la lista viene vacía por
defecto); el sitio nuevo declara `toxicity-properties` y levanta un worker
suscrito a la cola `heavy`.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings

from apps.core.models import ScientificJob
from apps.core.tasks import dispatch_scientific_job

DELAY_TARGET = "apps.core.tasks.execute_scientific_job.delay"
APPLY_ASYNC_TARGET = "apps.core.tasks.execute_scientific_job.apply_async"


def _create_job(plugin_name: str) -> ScientificJob:
    return ScientificJob.objects.create(
        job_hash=uuid4().hex,
        plugin_name=plugin_name,
        algorithm_version="1.0.0",
        status="pending",
        parameters={},
        results=None,
    )


class HeavyQueueRoutingTests(TestCase):
    """Verifica que la cola pesada solo se usa cuando está declarada."""

    @patch(APPLY_ASYNC_TARGET)
    @patch(DELAY_TARGET)
    def test_without_heavy_plugins_dispatch_uses_default_queue(
        self, delay_mock, apply_async_mock
    ) -> None:
        job = _create_job("toxicity-properties")

        dispatched = dispatch_scientific_job(str(job.id))

        self.assertTrue(dispatched)
        delay_mock.assert_called_once_with(str(job.id))
        apply_async_mock.assert_not_called()

    @override_settings(
        CELERY_HEAVY_PLUGINS=("toxicity-properties",), CELERY_HEAVY_QUEUE="heavy"
    )
    @patch(APPLY_ASYNC_TARGET)
    @patch(DELAY_TARGET)
    def test_declared_heavy_plugin_goes_to_heavy_queue(
        self, delay_mock, apply_async_mock
    ) -> None:
        job = _create_job("toxicity-properties")

        dispatched = dispatch_scientific_job(str(job.id))

        self.assertTrue(dispatched)
        apply_async_mock.assert_called_once_with(args=[str(job.id)], queue="heavy")
        delay_mock.assert_not_called()

    @override_settings(
        CELERY_HEAVY_PLUGINS=("toxicity-properties",), CELERY_HEAVY_QUEUE="heavy"
    )
    @patch(APPLY_ASYNC_TARGET)
    @patch(DELAY_TARGET)
    def test_non_heavy_plugin_keeps_default_queue(
        self, delay_mock, apply_async_mock
    ) -> None:
        job = _create_job("molar-fractions")

        dispatched = dispatch_scientific_job(str(job.id))

        self.assertTrue(dispatched)
        delay_mock.assert_called_once_with(str(job.id))
        apply_async_mock.assert_not_called()

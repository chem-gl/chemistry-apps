"""test_concurrency.py: Tests del semáforo de concurrencia anónima.

Cubre la clave por cliente, la adquisición/liberación del lease (con Redis
simulado), la persistencia en el job, la integración con el create público y la
liberación vía señales de Celery.
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from redis.exceptions import RedisError
from rest_framework.test import APIClient, APIRequestFactory

from ..anonymous import purge_expired_anonymous_jobs
from ..concurrency import (
    KEY_NAMESPACE,
    ConcurrencyLease,
    acquire_registered_slot,
    acquire_slot,
    attach_lease_to_job,
    build_lease_key,
    build_registered_lease_key,
    release_job_lease,
    release_lease,
    resolve_registered_max_concurrent_jobs,
)
from ..models import ScientificJob
from ..realtime import build_scientific_job_payload
from ..signals import (
    EXECUTE_JOB_TASK_NAME,
    _extract_job_id,
    release_concurrency_lease_after_task,
)

PUBLIC_MOLAR_URL = "/api/public/molar-fractions/jobs/"
PRIVATE_MOLAR_URL = "/api/molar-fractions/jobs/"
MOLAR_PAYLOAD: dict[str, object] = {
    "version": "1.0.0",
    "pka_values": [4.75],
    "initial_charge": -1,
    "label": "Ac",
    "ph_mode": "single",
    "ph_value": 7.4,
}


class FakeRedis:
    """Cliente Redis simulado: registra llamadas y devuelve un resultado fijo."""

    def __init__(self, *, result: int = 1, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple[object, ...]] = []

    def eval(self, _script: str, _numkeys: int, *args: object) -> int:
        if self.error is not None:
            raise self.error
        self.calls.append(args)
        return self.result


def _create_job(**overrides: object) -> ScientificJob:
    """Crea un job mínimo persistido para pruebas de lease."""
    defaults: dict[str, object] = {
        "job_hash": uuid4().hex,
        "plugin_name": "molar-fractions",
        "algorithm_version": "1.0.0",
        "status": "pending",
        "parameters": {},
    }
    defaults.update(overrides)
    return ScientificJob.objects.create(**defaults)


class LeaseKeyTests(TestCase):
    """Verifica la clave del semáforo por cliente."""

    def setUp(self) -> None:
        self.factory = APIRequestFactory()

    def test_same_client_produces_same_key(self) -> None:
        first_key = build_lease_key(self.factory.get("/", REMOTE_ADDR="1.2.3.4"))
        second_key = build_lease_key(self.factory.get("/", REMOTE_ADDR="1.2.3.4"))

        self.assertEqual(first_key, second_key)
        self.assertTrue(first_key.startswith(KEY_NAMESPACE))

    def test_different_clients_produce_different_keys(self) -> None:
        first_key = build_lease_key(self.factory.get("/", REMOTE_ADDR="1.2.3.4"))
        second_key = build_lease_key(self.factory.get("/", REMOTE_ADDR="5.6.7.8"))

        self.assertNotEqual(first_key, second_key)

    def test_key_does_not_expose_client_identifier(self) -> None:
        lease_key = build_lease_key(self.factory.get("/", REMOTE_ADDR="1.2.3.4"))

        self.assertNotIn("1.2.3.4", lease_key)


class AcquireSlotTests(TestCase):
    """Verifica la adquisición del cupo con Redis simulado."""

    def setUp(self) -> None:
        self.factory = APIRequestFactory()
        self.request = self.factory.get("/", REMOTE_ADDR="10.0.0.1")

    def test_returns_lease_when_slot_is_available(self) -> None:
        fake_client = FakeRedis(result=1)

        lease = acquire_slot(self.request, client=fake_client)

        self.assertIsNotNone(lease)
        self.assertFalse(lease.is_noop)  # type: ignore[union-attr]
        self.assertEqual(len(fake_client.calls), 1)

    def test_returns_none_when_slots_are_exhausted(self) -> None:
        fake_client = FakeRedis(result=0)

        lease = acquire_slot(self.request, client=fake_client)

        self.assertIsNone(lease)

    def test_fails_open_when_redis_is_unavailable(self) -> None:
        fake_client = FakeRedis(error=RedisError("connection refused"))

        lease = acquire_slot(self.request, client=fake_client)

        self.assertIsNotNone(lease)
        self.assertTrue(lease.is_noop)  # type: ignore[union-attr]

    @override_settings(ANONYMOUS_MAX_CONCURRENT_JOBS=3, ANONYMOUS_CONCURRENCY_LEASE_SECONDS=120)
    def test_configured_limits_are_passed_to_the_script(self) -> None:
        fake_client = FakeRedis(result=1)

        acquire_slot(self.request, client=fake_client)

        script_args = fake_client.calls[0]
        self.assertEqual(script_args[3], 3)
        self.assertEqual(script_args[5], 240_000)


class LeaseReleaseTests(TestCase):
    """Verifica la liberación idempotente del lease."""

    def test_noop_lease_does_not_touch_redis(self) -> None:
        fake_client = FakeRedis()

        release_lease(ConcurrencyLease(key="", token=""), client=fake_client)

        self.assertEqual(fake_client.calls, [])

    def test_release_swallows_redis_errors(self) -> None:
        fake_client = FakeRedis(error=RedisError("down"))

        release_lease(ConcurrencyLease(key="k", token="t"), client=fake_client)

    def test_lease_is_persisted_and_cleared_from_job(self) -> None:
        job = _create_job()

        attach_lease_to_job(job, ConcurrencyLease(key="k", token="t"))
        job.refresh_from_db()
        self.assertEqual(
            job.runtime_state["concurrency_lease"], {"key": "k", "token": "t"}
        )

        fake_client = FakeRedis()
        release_job_lease(job, client=fake_client)
        job.refresh_from_db()

        self.assertEqual(job.runtime_state, {})
        self.assertEqual(len(fake_client.calls), 1)


@override_settings(OPEN_MODE_ENABLED=True)
class PublicDispatchConcurrencyTests(TestCase):
    """Verifica la integración del semáforo con el create público.

    Fuerza el modo abierto: estos tests miden el semáforo de concurrencia, no
    el interruptor global `OPEN_MODE_ENABLED` (que en local puede estar
    apagado y respondería 404 a toda la superficie pública).
    """

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def tearDown(self) -> None:
        cache.clear()

    def test_exhausted_slots_return_429(self) -> None:
        with patch("apps.core.public_api.acquire_slot", return_value=None):
            response = self.client.post(PUBLIC_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 429)

    def test_lease_is_attached_to_the_pending_job(self) -> None:
        lease = ConcurrencyLease(key="lease-key", token="lease-token")

        with (
            patch("apps.core.public_api.acquire_slot", return_value=lease),
            patch(
                "apps.molar_fractions.routers.dispatch_scientific_job",
                return_value=True,
            ),
        ):
            response = self.client.post(PUBLIC_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 201)
        job = ScientificJob.objects.get(pk=response.data["id"])
        self.assertEqual(
            job.runtime_state["concurrency_lease"],
            {"key": "lease-key", "token": "lease-token"},
        )

    def test_lease_is_released_when_creation_fails(self) -> None:
        lease = ConcurrencyLease(key="lease-key", token="lease-token")

        with (
            patch("apps.core.public_api.acquire_slot", return_value=lease),
            patch("apps.core.public_api.release_lease") as mock_release,
        ):
            response = self.client.post(PUBLIC_MOLAR_URL, {"bad": "payload"}, format="json")

        self.assertEqual(response.status_code, 400)
        mock_release.assert_called_once_with(lease)


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_THROTTLE_RATES": {
            "public-dispatch": "60/hour",
            "public-read": "120/hour",
            "registered-dispatch": "2/hour",
        }
    },
    TESTING=False,
)
class RegisteredDispatchThrottleTests(TestCase):
    """El tope de despachos de registrados solo limita el create.

    El semáforo de concurrencia se parcha con un lease no-op: este test mide
    el throttle de tasa y no debe tocar Redis (ni dejar leases colgados que
    contaminen otras corridas).
    """

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username="registered-throttle")
        self.client.force_authenticate(user=self.user)
        acquire_patcher = patch(
            "apps.core.base_router.acquire_registered_slot",
            return_value=ConcurrencyLease(key="", token=""),
        )
        self.addCleanup(acquire_patcher.stop)
        acquire_patcher.start()

    def tearDown(self) -> None:
        cache.clear()

    def test_dispatch_is_throttled_but_retrieve_is_not(self) -> None:
        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job",
            return_value=True,
        ):
            first = self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")
            second = self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")
            third = self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(third.status_code, 429)

        job_id = str(first.data["id"])
        for _ in range(5):
            retrieve_response = self.client.get(f"{PRIVATE_MOLAR_URL}{job_id}/")
            self.assertEqual(retrieve_response.status_code, 200)


class LeasePreservationTests(TestCase):
    """El fin terminal/pausa no debe borrar el lease antes del postrun.

    Regresión real: `finish_with_*` sobrescribía `runtime_state`, el postrun
    ya no encontraba el lease y el cupo quedaba huérfano en Redis hasta el
    TTL (el modo libre se quedaba sin sus 2 slots).
    """

    def _create_job_with_lease(self) -> ScientificJob:
        job = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="running",
            parameters={},
            results=None,
            runtime_state={
                "concurrency_lease": {"key": "lease-key", "token": "lease-token"}
            },
        )
        return job

    def test_completion_preserves_lease_for_postrun(self) -> None:
        from apps.core.services.terminal_states import finish_with_result

        job = self._create_job_with_lease()

        finish_with_result(
            job=job,
            job_id=str(job.id),
            result_payload={},
            from_cache=False,
            progress_publisher=SimpleNamespace(publish=lambda *a, **k: None),
            log_publisher=SimpleNamespace(publish=lambda *a, **k: None),
        )

        job.refresh_from_db()
        self.assertEqual(
            job.runtime_state.get("concurrency_lease"),
            {"key": "lease-key", "token": "lease-token"},
        )

    def test_pause_checkpoint_preserves_lease(self) -> None:
        from apps.core.services.terminal_states import finish_with_pause

        job = self._create_job_with_lease()

        finish_with_pause(
            job=job,
            job_id=str(job.id),
            pause_message="pausado",
            checkpoint={"step": 3},
            progress_publisher=SimpleNamespace(publish=lambda *a, **k: None),
            log_publisher=SimpleNamespace(publish=lambda *a, **k: None),
        )

        job.refresh_from_db()
        runtime_state = job.runtime_state
        self.assertEqual(runtime_state.get("step"), 3)
        self.assertEqual(
            runtime_state.get("concurrency_lease"),
            {"key": "lease-key", "token": "lease-token"},
        )

    def test_full_cycle_releases_slot_with_realistic_flow(self) -> None:
        from apps.core.services.terminal_states import finish_with_result

        job = self._create_job_with_lease()
        fake_client = FakeRedis(result=1)

        attach_lease_to_job(
            job,
            ConcurrencyLease(key="cycle-key", token="cycle-token"),
        )
        finish_with_result(
            job=job,
            job_id=str(job.id),
            result_payload={},
            from_cache=False,
            progress_publisher=SimpleNamespace(publish=lambda *a, **k: None),
            log_publisher=SimpleNamespace(publish=lambda *a, **k: None),
        )
        release_job_lease(job, client=fake_client)

        job.refresh_from_db()
        self.assertNotIn("concurrency_lease", job.runtime_state)


class StaleWorkerLeaseRaceTests(TestCase):
    """Regresión del 429 fantasma: el worker termina con un `job` obsoleto.

    Orden demostrado en producción: el worker carga el job (con
    `runtime_state={}`) **antes** de que el proceso HTTP lo adjunte con
    `attach_lease_to_job`. Si el fin terminal escribiera el valor en memoria,
    borraría el lease recién persistido y `task_postrun` no encontraría nada que
    liberar: el cupo queda ocupado hasta el TTL con 0 jobs en curso.
    """

    LATE_LEASE = ConcurrencyLease(key="late-key", token="late-token")
    PUBLISHERS = {
        "progress_publisher": SimpleNamespace(publish=lambda *a, **k: None),
        "log_publisher": SimpleNamespace(publish=lambda *a, **k: None),
    }

    def _race(self) -> tuple[ScientificJob, ScientificJob]:
        """Devuelve (job_persistido, copia_obsoleta_del_worker) con lease tardío."""
        persisted = _create_job(status="running", runtime_state={})
        stale_copy = ScientificJob.objects.get(pk=persisted.pk)

        attach_lease_to_job(persisted, self.LATE_LEASE)

        self.assertEqual(stale_copy.runtime_state, {})
        return persisted, stale_copy

    def test_completion_keeps_lease_attached_after_job_load(self) -> None:
        from apps.core.services.terminal_states import finish_with_result

        persisted, stale_copy = self._race()
        finish_with_result(
            job=stale_copy,
            job_id=str(stale_copy.id),
            result_payload={},
            from_cache=False,
            **self.PUBLISHERS,
        )

        persisted.refresh_from_db()
        self.assertEqual(
            persisted.runtime_state,
            {"concurrency_lease": {"key": "late-key", "token": "late-token"}},
        )

    def test_pause_keeps_lease_attached_after_job_load(self) -> None:
        from apps.core.services.terminal_states import finish_with_pause

        persisted, stale_copy = self._race()
        finish_with_pause(
            job=stale_copy,
            job_id=str(stale_copy.id),
            pause_message="pausado",
            checkpoint={"step": 7},
            **self.PUBLISHERS,
        )

        persisted.refresh_from_db()
        self.assertEqual(persisted.runtime_state.get("step"), 7)
        self.assertEqual(
            persisted.runtime_state.get("concurrency_lease"),
            {"key": "late-key", "token": "late-token"},
        )

    def test_postrun_signal_releases_the_late_lease(self) -> None:
        """El ciclo completo: terminar con objeto obsoleto y liberar vía señal."""
        from apps.core.services.terminal_states import finish_with_result

        persisted, stale_copy = self._race()
        finish_with_result(
            job=stale_copy,
            job_id=str(stale_copy.id),
            result_payload={},
            from_cache=False,
            **self.PUBLISHERS,
        )

        with patch("apps.core.concurrency.release_lease") as mock_release:
            release_concurrency_lease_after_task(
                sender=SimpleNamespace(name=EXECUTE_JOB_TASK_NAME),
                args=(str(persisted.id),),
                kwargs={},
            )

        mock_release.assert_called_once_with(self.LATE_LEASE, client=None)

    def test_release_uses_the_real_redis_client_after_stale_finish(self) -> None:
        """Con un cliente falso se comprueba el ZREM efectivo del lease tardío."""
        from apps.core.services.terminal_states import finish_with_result

        persisted, stale_copy = self._race()
        finish_with_result(
            job=stale_copy,
            job_id=str(stale_copy.id),
            result_payload={},
            from_cache=False,
            **self.PUBLISHERS,
        )

        fake_client = FakeRedis(result=1)
        release_job_lease(
            ScientificJob.objects.get(pk=persisted.pk), client=fake_client
        )

        self.assertEqual(fake_client.calls, [("late-key", "late-token")])
        persisted.refresh_from_db()
        self.assertNotIn("concurrency_lease", persisted.runtime_state)

    def test_completion_without_lease_is_unaffected(self) -> None:
        """Sin lease en ningún lado no se rompe nada ni aparecen claves extra."""
        from apps.core.services.terminal_states import finish_with_result

        persisted = _create_job(status="running", runtime_state={})
        stale_copy = ScientificJob.objects.get(pk=persisted.pk)
        finish_with_result(
            job=stale_copy,
            job_id=str(stale_copy.id),
            result_payload={"ok": 1},
            from_cache=False,
            **self.PUBLISHERS,
        )

        persisted.refresh_from_db()
        self.assertEqual(persisted.status, "completed")
        self.assertEqual(persisted.runtime_state, {})

    def test_pause_without_lease_keeps_only_the_checkpoint(self) -> None:
        from apps.core.services.terminal_states import finish_with_pause

        persisted = _create_job(status="running", runtime_state={})
        stale_copy = ScientificJob.objects.get(pk=persisted.pk)
        finish_with_pause(
            job=stale_copy,
            job_id=str(stale_copy.id),
            pause_message="pausado",
            checkpoint={"step": 3},
            **self.PUBLISHERS,
        )

        persisted.refresh_from_db()
        self.assertEqual(persisted.runtime_state, {"step": 3})

    def test_in_memory_lease_is_used_when_db_has_none(self) -> None:
        """Si la BD ya no tiene el lease, se conserva el que trae el worker."""
        from apps.core.services.terminal_states import finish_with_result

        persisted = _create_job(
            status="running",
            runtime_state={"concurrency_lease": {"key": "local", "token": "local"}},
        )
        worker_copy = ScientificJob.objects.get(pk=persisted.pk)
        ScientificJob.objects.filter(pk=persisted.pk).update(runtime_state={})

        finish_with_result(
            job=worker_copy, job_id=str(worker_copy.id), result_payload={},
            from_cache=False, **self.PUBLISHERS,
        )

        persisted.refresh_from_db()
        self.assertEqual(
            persisted.runtime_state,
            {"concurrency_lease": {"key": "local", "token": "local"}},
        )


class LeaseAttachGuardTests(TestCase):
    """Verifica que no se adjunte un lease a un job que ya terminó."""

    def test_attach_releases_when_job_is_already_terminal(self) -> None:
        job = _create_job(status="completed")
        lease = ConcurrencyLease(key="k", token="t")

        with patch("apps.core.concurrency.release_lease") as mock_release:
            attach_lease_to_job(job, lease)

        mock_release.assert_called_once_with(lease)
        job.refresh_from_db()
        self.assertNotIn("concurrency_lease", job.runtime_state)

    def test_attach_persists_when_job_is_still_pending(self) -> None:
        job = _create_job(status="pending")
        lease = ConcurrencyLease(key="k", token="t")

        attach_lease_to_job(job, lease)

        job.refresh_from_db()
        self.assertEqual(
            job.runtime_state["concurrency_lease"], {"key": "k", "token": "t"}
        )


class PurgeReleasesLeasesTests(TestCase):
    """Verifica que la purga libere los leases antes de borrar los jobs."""

    def test_purge_releases_lease_before_deleting(self) -> None:
        expired_job = _create_job(
            expires_at=timezone.now() - timedelta(hours=1),
            runtime_state={"concurrency_lease": {"key": "k", "token": "t"}},
        )

        with patch("apps.core.concurrency.release_lease") as mock_release:
            purged = purge_expired_anonymous_jobs()

        self.assertEqual(purged, 1)
        mock_release.assert_called_once()
        self.assertFalse(ScientificJob.objects.filter(pk=expired_job.pk).exists())


class RealtimePayloadTests(TestCase):
    """Verifica que el payload realtime no exponga estado interno de control."""

    def test_payload_excludes_internal_runtime_state_keys(self) -> None:
        job = _create_job(
            runtime_state={
                "concurrency_lease": {"key": "k", "token": "t"},
                "custom_state": "visible",
            }
        )

        payload = build_scientific_job_payload(job)

        self.assertNotIn("concurrency_lease", payload["runtime_state"])
        self.assertEqual(payload["runtime_state"], {"custom_state": "visible"})


class ConcurrencySignalTests(TestCase):
    """Verifica la liberación del cupo desde las señales de Celery."""

    def test_extract_job_id_from_positional_and_keyword_arguments(self) -> None:
        self.assertEqual(_extract_job_id(("job-1",), {}), "job-1")
        self.assertEqual(_extract_job_id((), {"job_id": "job-2"}), "job-2")
        self.assertIsNone(_extract_job_id((), {}))

    def test_postrun_signal_releases_the_job_lease(self) -> None:
        job = _create_job(
            runtime_state={"concurrency_lease": {"key": "k", "token": "t"}}
        )
        sender = SimpleNamespace(name=EXECUTE_JOB_TASK_NAME)

        with patch("apps.core.concurrency.release_lease") as mock_release:
            release_concurrency_lease_after_task(
                sender=sender, args=(str(job.id),), kwargs={}
            )

        mock_release.assert_called_once()

    def test_postrun_signal_ignores_other_tasks(self) -> None:
        sender = SimpleNamespace(name="apps.core.tasks.other_task")

        with patch("apps.core.concurrency.release_lease") as mock_release:
            release_concurrency_lease_after_task(
                sender=sender, args=("job-1",), kwargs={}
            )

        mock_release.assert_not_called()


class RegisteredConcurrencyUnitTests(TestCase):
    """Clave y cupo del semáforo para usuarios autenticados."""

    def setUp(self) -> None:
        self.factory = APIRequestFactory()
        self.user_one = get_user_model().objects.create_user(username="conc-user-1")
        self.user_two = get_user_model().objects.create_user(username="conc-user-2")

    def _request_for(self, user: object):
        request = self.factory.post("/api/molar-fractions/jobs/")
        request.user = user
        return request

    def test_registered_key_is_per_user_and_hashed(self) -> None:
        key_one = build_registered_lease_key(self._request_for(self.user_one))
        key_two = build_registered_lease_key(self._request_for(self.user_two))

        self.assertNotEqual(key_one, key_two)
        self.assertTrue(key_one.startswith(f"{KEY_NAMESPACE}:user:"))
        self.assertNotIn(str(self.user_one.pk), key_one)

    def test_registered_default_quota_is_five(self) -> None:
        self.assertEqual(resolve_registered_max_concurrent_jobs(), 5)

    @override_settings(REGISTERED_MAX_CONCURRENT_JOBS=1)
    def test_registered_quota_reads_settings(self) -> None:
        self.assertEqual(resolve_registered_max_concurrent_jobs(), 1)

    def test_registered_slot_returns_none_when_quota_is_exhausted(self) -> None:
        lease = acquire_registered_slot(
            self._request_for(self.user_one), client=FakeRedis(result=0)
        )

        self.assertIsNone(lease)

    def test_registered_slot_requires_authenticated_actor(self) -> None:
        anonymous_request = self.factory.post("/api/molar-fractions/jobs/")
        anonymous_request.user = SimpleNamespace(pk=None, is_authenticated=False)

        with self.assertRaises(ValueError):
            build_registered_lease_key(anonymous_request)


@override_settings(TESTING=False)
class RegisteredDispatchConcurrencyTests(TestCase):
    """Integración del semáforo registrado con el create privado de una app."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username="registered-conc")
        self.client.force_authenticate(user=self.user)

    def tearDown(self) -> None:
        cache.clear()

    def test_exhausted_slots_return_429(self) -> None:
        with patch("apps.core.base_router.acquire_registered_slot", return_value=None):
            response = self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 429)

    def test_lease_is_attached_to_the_created_job(self) -> None:
        lease = ConcurrencyLease(key="reg-key", token="reg-token")

        with (
            patch("apps.core.base_router.acquire_registered_slot", return_value=lease),
            patch(
                "apps.molar_fractions.routers.dispatch_scientific_job",
                return_value=True,
            ),
        ):
            response = self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 201)
        job = ScientificJob.objects.get(pk=response.data["id"])
        self.assertEqual(
            job.runtime_state["concurrency_lease"],
            {"key": "reg-key", "token": "reg-token"},
        )

    def test_lease_is_released_when_creation_fails(self) -> None:
        lease = ConcurrencyLease(key="reg-key", token="reg-token")

        with (
            patch("apps.core.base_router.acquire_registered_slot", return_value=lease),
            patch("apps.core.base_router.release_lease") as mock_release,
        ):
            response = self.client.post(PRIVATE_MOLAR_URL, {"bad": "payload"}, format="json")

        self.assertEqual(response.status_code, 400)
        mock_release.assert_called_once_with(lease)

    @override_settings(TESTING=True)
    def test_guard_is_skipped_in_test_mode(self) -> None:
        with patch("apps.core.base_router.acquire_registered_slot") as mock_acquire:
            self.client.post(PRIVATE_MOLAR_URL, MOLAR_PAYLOAD, format="json")

        mock_acquire.assert_not_called()

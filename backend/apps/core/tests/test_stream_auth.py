"""test_stream_auth.py: Tests de autenticación del streaming (SSE y WebSocket).

Cubre:
- `QueryStringJWTAuthentication`: fallback `?token=<jwt>` para EventSource.
- `JobsStreamConsumer`: cierre de conexiones sin autenticar, validación del
  alcance pedido y snapshot acotado a la visibilidad del actor.
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.consumers import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_UNAUTHENTICATED,
)
from apps.core.identity.authentication import QueryStringJWTAuthentication
from apps.core.models import ScientificJob
from apps.core.realtime import broadcast_job_update
from config.asgi import application

JOBS_STREAM_PATH = "/ws/jobs/stream/"


def _build_access_token(user: object) -> str:
    """Genera un access token JWT válido para el usuario indicado."""
    return str(RefreshToken.for_user(user).access_token)


def _create_job(**overrides: object) -> ScientificJob:
    """Crea un job persistido mínimo para pruebas de stream."""
    defaults: dict[str, object] = {
        "job_hash": "a" * 64,
        "plugin_name": "calculator",
        "algorithm_version": "1.0.0",
        "status": "running",
        "parameters": {},
    }
    defaults.update(overrides)
    return ScientificJob.objects.create(**defaults)


class QueryStringJWTAuthenticationTests(TestCase):
    """Verifica el fallback de token por query string."""

    def setUp(self) -> None:
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="stream-token-user")
        self.factory = APIRequestFactory()
        self.authentication = QueryStringJWTAuthentication()

    def _authenticate(self, query_values: dict[str, str]) -> object:
        """Ejecuta la autenticación DRF sobre un request con query string."""
        django_request = self.factory.get("/api/jobs/x/events/", query_values)
        return self.authentication.authenticate(Request(django_request))

    def test_valid_token_in_query_string_authenticates_user(self) -> None:
        access_token = _build_access_token(self.user)

        result = self._authenticate({"token": access_token})

        self.assertIsNotNone(result)
        self.assertEqual(result[0], self.user)  # type: ignore[index]

    def test_missing_token_returns_none(self) -> None:
        self.assertIsNone(self._authenticate({}))

    def test_invalid_token_is_rejected(self) -> None:
        with self.assertRaises(AuthenticationFailed):
            self._authenticate({"token": "not-a-valid-jwt"})

    def test_query_token_is_ignored_on_write_methods(self) -> None:
        """Evita exponer el token en URLs de escritura (logs, historial, Referer)."""
        access_token = _build_access_token(self.user)
        django_request = self.factory.post("/api/jobs/", {"token": access_token})

        result = self.authentication.authenticate(Request(django_request))

        self.assertIsNone(result)


class JobsStreamConsumerTests(TransactionTestCase):
    """Verifica las reglas de acceso del consumer WebSocket.

    Los tests son `async def` para que Django los ejecute dentro de
    `ThreadSensitiveContext`; usar `async_to_sync` en un test síncrono bloquea
    las llamadas `database_sync_to_async` del consumer.
    """

    def setUp(self) -> None:
        user_model = get_user_model()
        self.owner_user = user_model.objects.create_user(username="ws-owner")
        self.other_user = user_model.objects.create_user(username="ws-other")
        self.root_user = user_model.objects.create_user(
            username="ws-root",
            is_staff=True,
            is_superuser=True,
        )
        self.own_job = _create_job(owner=self.owner_user)
        self.foreign_job = _create_job(owner=self.other_user, job_hash="b" * 64)

    async def _connect(self, path: str) -> tuple[bool, int | None]:
        """Abre una conexión WebSocket y retorna (conectado, close_code)."""
        communicator = WebsocketCommunicator(application, path)
        connected, close_code = await communicator.connect()
        if connected:
            await communicator.disconnect()
        return connected, close_code

    async def test_connection_without_token_is_rejected(self) -> None:
        connected, close_code = await self._connect(JOBS_STREAM_PATH)

        self.assertFalse(connected)
        self.assertEqual(close_code, WS_CLOSE_UNAUTHENTICATED)

    async def test_owner_can_subscribe_to_own_job(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)

        connected, _ = await self._connect(
            f"{JOBS_STREAM_PATH}?job_id={self.own_job.id}&token={access_token}"
        )

        self.assertTrue(connected)

    async def test_user_cannot_subscribe_to_foreign_job(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)

        connected, close_code = await self._connect(
            f"{JOBS_STREAM_PATH}?job_id={self.foreign_job.id}&token={access_token}"
        )

        self.assertFalse(connected)
        self.assertEqual(close_code, WS_CLOSE_FORBIDDEN)

    async def test_unknown_job_is_rejected(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)

        connected, close_code = await self._connect(
            f"{JOBS_STREAM_PATH}?job_id=11111111-1111-1111-1111-111111111111"
            f"&token={access_token}"
        )

        self.assertFalse(connected)
        self.assertEqual(close_code, WS_CLOSE_NOT_FOUND)

    async def test_global_scope_requires_admin(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)

        connected, close_code = await self._connect(
            f"{JOBS_STREAM_PATH}?token={access_token}"
        )

        self.assertFalse(connected)
        self.assertEqual(close_code, WS_CLOSE_FORBIDDEN)

    async def test_root_can_use_global_scope(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.root_user)

        connected, _ = await self._connect(f"{JOBS_STREAM_PATH}?token={access_token}")

        self.assertTrue(connected)

    async def test_authenticated_user_can_filter_by_plugin(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)

        connected, _ = await self._connect(
            f"{JOBS_STREAM_PATH}?plugin_name=calculator&token={access_token}"
        )

        self.assertTrue(connected)

    async def test_snapshot_is_limited_to_visible_jobs(self) -> None:
        access_token = await database_sync_to_async(_build_access_token)(self.owner_user)
        communicator = WebsocketCommunicator(
            application,
            f"{JOBS_STREAM_PATH}?plugin_name=calculator&token={access_token}",
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        snapshot_message = await communicator.receive_json_from()
        await communicator.disconnect()

        self.assertEqual(snapshot_message["event"], "jobs.snapshot")
        visible_job_ids = {
            str(item["id"]) for item in snapshot_message["data"]["items"]
        }
        self.assertIn(str(self.own_job.id), visible_job_ids)
        self.assertNotIn(str(self.foreign_job.id), visible_job_ids)

    async def test_plugin_scope_does_not_leak_live_events_of_other_users(
        self,
    ) -> None:
        """Los eventos en vivo respetan la visibilidad, no solo el snapshot."""
        access_token = await database_sync_to_async(_build_access_token)(
            self.owner_user
        )
        communicator = WebsocketCommunicator(
            application,
            f"{JOBS_STREAM_PATH}?plugin_name=calculator&include_snapshot=false"
            f"&token={access_token}",
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        await database_sync_to_async(broadcast_job_update)(self.foreign_job)
        self.assertTrue(await communicator.receive_nothing(timeout=0.4))

        await database_sync_to_async(broadcast_job_update)(self.own_job)
        received_message = await communicator.receive_json_from(timeout=2)

        await communicator.disconnect()

        self.assertEqual(received_message["event"], "job.updated")
        self.assertEqual(str(received_message["data"]["id"]), str(self.own_job.id))

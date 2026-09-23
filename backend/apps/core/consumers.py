"""consumers.py: Consumers WebSocket para progreso y logs en tiempo real.

Objetivo del archivo:
- Implementar el canal bidireccional de observabilidad para jobs científicos.

Cómo se usa:
- Channels enruta conexiones a `JobsStreamConsumer` mediante `routing.py`.
- El cliente puede filtrar por `job_id` o `plugin_name` y pedir snapshot inicial.
- Los eventos emitidos por `realtime.py` se reenvían en formato JSON estable.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core.exceptions import ValidationError
from django.urls import path

from .definitions import CORE_JOBS_WEBSOCKET_ROUTE_PATH
from .identity.services import AuthorizationService
from .models import ScientificJob
from .realtime import (
    build_scientific_job_payload,
    get_jobs_global_group_name,
    get_jobs_job_group_name,
    get_jobs_plugin_group_name,
)

# Códigos de cierre WebSocket propios (rango 4000-4999 = aplicación).
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_FORBIDDEN = 4403
WS_CLOSE_NOT_FOUND = 4404


@database_sync_to_async
def _resolve_scope_access(
    actor: object,
    *,
    job_id: str | None,
    plugin_name: str | None,
) -> str:
    """Resuelve si el actor puede suscribirse al alcance pedido.

    - `job_id`: solo si puede ver ese job (404 propio si no existe).
    - `plugin_name`: lectura de un plugin concreto, permitida a autenticados.
    - sin filtros (alcance global): solo root/admin, porque el grupo global
      emite eventos de todos los plugins y usuarios.
    """
    if job_id is not None:
        try:
            job = ScientificJob.objects.filter(pk=job_id).first()
        except (ValueError, ValidationError):
            return "not_found"

        if job is None:
            return "not_found"

        return (
            "ok"
            if AuthorizationService.can_view_job(actor=actor, job=job)
            else "denied"
        )

    if plugin_name is not None:
        return "ok"

    if AuthorizationService.is_root(actor) or AuthorizationService.is_admin(actor):
        return "ok"

    return "denied"


class JobsStreamConsumer(AsyncJsonWebsocketConsumer):
    """Expone un stream WebSocket global o filtrado de jobs, progreso y logs."""

    group_names: list[str]
    job_id_filter: str | None
    plugin_name_filter: str | None
    include_logs: bool
    include_snapshot: bool
    active_only: bool

    async def connect(self) -> None:
        """Autentica, valida el alcance pedido y suscribe el socket.

        Rechaza la conexión cuando no hay usuario autenticado (sesión o
        `?token=<access>`), cuando el job pedido no es visible para el actor o
        cuando se pide el alcance global sin ser root/admin.
        """
        actor = self.scope.get("user")
        if actor is None or not bool(getattr(actor, "is_authenticated", False)):
            await self.close(code=WS_CLOSE_UNAUTHENTICATED)
            return

        query_values = parse_qs(self.scope["query_string"].decode("utf-8"))
        self.job_id_filter = self._read_optional_query_value(query_values, "job_id")
        self.plugin_name_filter = self._read_optional_query_value(
            query_values,
            "plugin_name",
        )
        self.include_logs = self._read_bool_query_value(
            query_values,
            "include_logs",
            default_value=True,
        )
        self.include_snapshot = self._read_bool_query_value(
            query_values,
            "include_snapshot",
            default_value=True,
        )
        self.active_only = self._read_bool_query_value(
            query_values,
            "active_only",
            default_value=False,
        )

        scope_access = await _resolve_scope_access(
            actor,
            job_id=self.job_id_filter,
            plugin_name=self.plugin_name_filter,
        )
        if scope_access == "not_found":
            await self.close(code=WS_CLOSE_NOT_FOUND)
            return
        if scope_access == "denied":
            await self.close(code=WS_CLOSE_FORBIDDEN)
            return

        self.group_names = self._resolve_group_names()
        for group_name in self.group_names:
            await self.channel_layer.group_add(group_name, self.channel_name)

        await self.accept()

        if self.include_snapshot:
            snapshot_items = await self._load_initial_snapshot_items(actor)
            await self.send_json(
                {
                    "event": "jobs.snapshot",
                    "data": {"items": snapshot_items},
                }
            )

    async def disconnect(self, close_code: int) -> None:
        """Remueve el socket de los grupos al cerrar la conexión."""
        del close_code
        for group_name in getattr(self, "group_names", []):
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def jobs_stream_event(self, event: dict[str, object]) -> None:
        """Reenvía eventos broadcast a los clientes conectados."""
        event_name = str(event["event_name"])
        if event_name == "job.log" and not self.include_logs:
            return

        await self.send_json(
            {
                "event": event_name,
                "data": event["payload"],
            }
        )

    def _resolve_group_names(self) -> list[str]:
        """Resuelve los grupos a los que se suscribirá el socket actual."""
        if self.job_id_filter is not None:
            return [get_jobs_job_group_name(self.job_id_filter)]

        if self.plugin_name_filter is not None:
            return [get_jobs_plugin_group_name(self.plugin_name_filter)]

        return [get_jobs_global_group_name()]

    def _read_optional_query_value(
        self,
        query_values: dict[str, list[str]],
        key_name: str,
    ) -> str | None:
        """Lee un query param opcional de la conexión WebSocket."""
        raw_values: list[str] = query_values.get(key_name, [])
        if len(raw_values) == 0:
            return None

        normalized_value: str = str(raw_values[0]).strip()
        return normalized_value if normalized_value != "" else None

    def _read_bool_query_value(
        self,
        query_values: dict[str, list[str]],
        key_name: str,
        *,
        default_value: bool,
    ) -> bool:
        """Lee un query param booleano con semántica segura."""
        raw_value: str | None = self._read_optional_query_value(query_values, key_name)
        if raw_value is None:
            return default_value

        return raw_value.lower() in {"1", "true", "yes", "on"}

    @database_sync_to_async
    def _load_initial_snapshot_items(self, actor: object) -> list[dict[str, object]]:
        """Carga el snapshot inicial acotado a lo que el actor puede ver."""
        jobs_queryset = AuthorizationService.get_visible_jobs(actor=actor).order_by(
            "-updated_at"
        )

        if self.job_id_filter is not None:
            jobs_queryset = jobs_queryset.filter(id=self.job_id_filter)

        if self.plugin_name_filter is not None:
            jobs_queryset = jobs_queryset.filter(plugin_name=self.plugin_name_filter)

        if self.active_only:
            jobs_queryset = jobs_queryset.filter(
                status__in=["pending", "running", "paused"]
            )

        return [dict(build_scientific_job_payload(job)) for job in jobs_queryset[:250]]


websocket_urlpatterns = [
    # Ruta única de stream; el filtrado se maneja vía query params en el consumer.
    path(CORE_JOBS_WEBSOCKET_ROUTE_PATH, JobsStreamConsumer.as_asgi()),
]

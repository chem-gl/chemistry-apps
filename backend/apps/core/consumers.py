"""consumers.py: Consumers WebSocket para progreso y logs en tiempo real."""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import ScientificJob
from .realtime import (
    build_scientific_job_payload,
    get_jobs_global_group_name,
    get_jobs_job_group_name,
    get_jobs_plugin_group_name,
)


class JobsStreamConsumer(AsyncJsonWebsocketConsumer):
    """Expone un stream WebSocket global o filtrado de jobs, progreso y logs."""

    group_names: list[str]
    job_id_filter: str | None
    plugin_name_filter: str | None
    include_logs: bool
    include_snapshot: bool
    active_only: bool

    async def connect(self) -> None:
        """Suscribe el socket a los grupos adecuados y envía snapshot inicial."""
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

        self.group_names = self._resolve_group_names()
        for group_name in self.group_names:
            await self.channel_layer.group_add(group_name, self.channel_name)

        await self.accept()

        if self.include_snapshot:
            snapshot_items = await self._load_initial_snapshot_items()
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
    def _load_initial_snapshot_items(self) -> list[dict[str, object]]:
        """Carga snapshot inicial para evitar polling inmediato en frontend."""
        jobs_queryset = ScientificJob.objects.all().order_by("-updated_at")

        if self.job_id_filter is not None:
            jobs_queryset = jobs_queryset.filter(id=self.job_id_filter)

        if self.plugin_name_filter is not None:
            jobs_queryset = jobs_queryset.filter(plugin_name=self.plugin_name_filter)

        if self.active_only:
            jobs_queryset = jobs_queryset.filter(
                status__in=["pending", "running", "paused"]
            )

        return [dict(build_scientific_job_payload(job)) for job in jobs_queryset[:250]]

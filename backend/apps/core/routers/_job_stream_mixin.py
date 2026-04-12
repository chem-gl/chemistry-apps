"""_job_stream_mixin.py: Acciones de streaming y logs para Jobs Científicos.

Objetivo del archivo:
- Proveer mixin con endpoints logs, logs_events (SSE) y events (SSE) para JobViewSet.
- Encapsula la lógica de paginación de logs y streaming Server-Sent Events.

Cómo se usa:
- `JobViewSet` en `viewset.py` hereda de `JobStreamActionsMixin`.
"""

from __future__ import annotations

from typing import Callable, Iterator

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    OpenApiTypes,
    extend_schema,
)
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from ..definitions import (
    CORE_JOBS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_ROUTE_SUFFIX,
    DEFAULT_SSE_TIMEOUT_SECONDS,
)
from ..identity.services import AuthorizationService
from ..models import ScientificJob, ScientificJobLogEvent
from ..schemas import ErrorResponseSerializer, JobLogListSerializer
from ..types import JobLogEntry, JobLogListResponse
from .helpers import (
    SSE_MEDIA_TYPE,
    ServerSentEventsRenderer,
    build_job_log_entry,
    parse_non_negative_int,
    parse_timeout_seconds,
)
from .streaming import stream_job_events, stream_job_log_events


class JobStreamActionsMixin:
    """Mixin con acciones de consulta de logs y streaming SSE para jobs."""

    type JobSSEStreamFactory = Callable[..., Iterator[str]]

    def _resolve_last_event_index(self, request: Request) -> int:
        """Normaliza Last-Event-ID del request a índice entero no negativo."""
        last_event_id_header: str | None = request.headers.get("Last-Event-ID")
        if last_event_id_header is None or not last_event_id_header.isdigit():
            return 0
        return int(last_event_id_header)

    def _build_sse_response(
        self,
        *,
        request: Request,
        id: str | None,
        stream_factory: JobSSEStreamFactory,
    ) -> StreamingHttpResponse:
        """Construye respuesta SSE reutilizable para logs y progreso de jobs."""
        job: ScientificJob = get_object_or_404(
            ScientificJob.objects.filter(deleted_at__isnull=True),
            pk=id,
        )
        actor = request.user
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_view_job(actor=actor, job=job):
            return StreamingHttpResponse(status=status.HTTP_403_FORBIDDEN)

        last_event_index: int = self._resolve_last_event_index(request)
        timeout_seconds: int = parse_timeout_seconds(
            request.query_params.get("timeout_seconds")
        )

        response: StreamingHttpResponse = StreamingHttpResponse(
            stream_factory(
                job_id=str(job.id),
                last_event_index=last_event_index,
                timeout_seconds=timeout_seconds,
            ),
            content_type=SSE_MEDIA_TYPE,
            status=status.HTTP_200_OK,
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

    @extend_schema(
        summary="Consultar historial de logs de un Job",
        description=(
            "Devuelve eventos de log persistidos para un job en orden ascendente "
            "por event_index, con soporte de cursor incremental y límite de página."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            ),
            OpenApiParameter(
                name="after_event_index",
                type=int,
                location=OpenApiParameter.QUERY,
                description="Retorna eventos con índice mayor al valor indicado.",
            ),
            OpenApiParameter(
                name="limit",
                type=int,
                location=OpenApiParameter.QUERY,
                description="Cantidad máxima de eventos a devolver. Máximo 500.",
            ),
        ],
        responses={
            200: JobLogListSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path=CORE_JOBS_LOGS_ROUTE_SUFFIX)
    def logs(self, request: Request, id: str | None = None) -> Response:
        """Lista logs persistidos por job para diagnóstico y auditoría."""
        job: ScientificJob = get_object_or_404(
            ScientificJob.objects.filter(deleted_at__isnull=True),
            pk=id,
        )
        actor = request.user
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_view_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para ver los logs de este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

        after_event_index: int = parse_non_negative_int(
            request.query_params.get("after_event_index"),
            default_value=0,
        )
        raw_limit: int = parse_non_negative_int(
            request.query_params.get("limit"),
            default_value=50,
        )
        normalized_limit: int = max(1, min(500, raw_limit if raw_limit > 0 else 50))

        log_events_queryset = ScientificJobLogEvent.objects.filter(
            job=job,
            event_index__gt=after_event_index,
        ).order_by("event_index")[:normalized_limit]

        log_entries: list[JobLogEntry] = [
            build_job_log_entry(log_event) for log_event in log_events_queryset
        ]
        next_after_event_index: int = (
            log_entries[-1]["event_index"]
            if len(log_entries) > 0
            else after_event_index
        )
        response_payload: JobLogListResponse = {
            "job_id": str(job.id),
            "count": len(log_entries),
            "next_after_event_index": next_after_event_index,
            "results": log_entries,
        }
        serializer = JobLogListSerializer(response_payload)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Suscribirse a logs de un Job (SSE)",
        description=(
            "Abre un stream Server-Sent Events para recibir logs en tiempo real "
            "hasta timeout o finalización del job."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            ),
            OpenApiParameter(
                name="timeout_seconds",
                type=int,
                location=OpenApiParameter.QUERY,
                description=(
                    "Tiempo máximo del stream SSE en segundos. "
                    f"Valor por defecto: {DEFAULT_SSE_TIMEOUT_SECONDS}."
                ),
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.STR,
                description="Flujo SSE de eventos job.log con id incremental.",
                examples=[
                    OpenApiExample(
                        "Evento SSE de log",
                        value=(
                            "id: 12\n"
                            "event: job.log\n"
                            'data: {"job_id":"8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",'
                            '"event_index":12,"level":"info",'
                            '"source":"random_numbers.plugin",'
                            '"message":"Procesando lote de generación.",'
                            '"payload":{"current_batch_size":5},'
                            '"created_at":"2026-03-11T10:25:00Z"}\n\n'
                        ),
                    )
                ],
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
    )
    @action(
        detail=True,
        methods=["get"],
        url_path=CORE_JOBS_LOGS_EVENTS_ROUTE_SUFFIX,
        renderer_classes=[ServerSentEventsRenderer],
    )
    def logs_events(
        self, request: Request, id: str | None = None
    ) -> StreamingHttpResponse:
        """Expone stream SSE de logs de job para observabilidad en tiempo real."""
        return self._build_sse_response(
            request=request,
            id=id,
            stream_factory=stream_job_log_events,
        )

    @extend_schema(
        summary="Suscribirse a eventos de progreso de un Job (SSE)",
        description=(
            "Abre un stream Server-Sent Events para recibir actualizaciones de "
            "progreso en tiempo real hasta completar/fallar o alcanzar timeout."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            ),
            OpenApiParameter(
                name="timeout_seconds",
                type=int,
                location=OpenApiParameter.QUERY,
                description=(
                    "Tiempo máximo del stream SSE en segundos. "
                    f"Valor por defecto: {DEFAULT_SSE_TIMEOUT_SECONDS}."
                ),
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.STR,
                description="Flujo SSE de eventos job.progress con id incremental.",
                examples=[
                    OpenApiExample(
                        "Evento SSE",
                        value=(
                            "id: 4\n"
                            "event: job.progress\n"
                            'data: {"job_id":"8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",'
                            '"status":"running","progress_percentage":35,'
                            '"progress_stage":"running",'
                            '"progress_message":"Ejecutando plugin científico.",'
                            '"progress_event_index":4,'
                            '"updated_at":"2026-03-10T12:00:00Z"}\n\n'
                        ),
                    )
                ],
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
    )
    @action(
        detail=True,
        methods=["get"],
        url_path=CORE_JOBS_EVENTS_ROUTE_SUFFIX,
        renderer_classes=[ServerSentEventsRenderer],
    )
    def events(self, request: Request, id: str | None = None) -> StreamingHttpResponse:
        """Expone stream SSE de progreso del job con heartbeats de conexión."""
        return self._build_sse_response(
            request=request,
            id=id,
            stream_factory=stream_job_events,
        )

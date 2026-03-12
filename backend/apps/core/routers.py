"""routers.py: Endpoints HTTP desacoplados que orquestan servicios core."""

import json
from time import monotonic, sleep
from typing import Iterator, cast

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    OpenApiTypes,
    extend_schema,
)
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.renderers import BaseRenderer
from rest_framework.request import Request
from rest_framework.response import Response

from .definitions import (
    ALLOWED_JOB_STATUS_FILTERS,
    CORE_JOBS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_ROUTE_SUFFIX,
    CORE_JOBS_PAUSE_ROUTE_SUFFIX,
    CORE_JOBS_PROGRESS_ROUTE_SUFFIX,
    CORE_JOBS_RESUME_ROUTE_SUFFIX,
    DEFAULT_SSE_TIMEOUT_SECONDS,
    MAX_SSE_TIMEOUT_SECONDS,
    SSE_POLL_INTERVAL_SECONDS,
)
from .models import ScientificJob, ScientificJobLogEvent
from .schemas import (
    ErrorResponseSerializer,
    JobControlActionResponseSerializer,
    JobCreateSerializer,
    JobLogListSerializer,
    JobProgressSnapshotSerializer,
    ScientificJobSerializer,
)
from .services import JobService
from .tasks import dispatch_scientific_job
from .types import (
    JobCreatePayload,
    JobLogEntry,
    JobLogLevel,
    JobLogListResponse,
    JobProgressSnapshot,
    JobProgressStage,
    JobStatus,
    JSONMap,
)


class ServerSentEventsRenderer(BaseRenderer):
    """Renderer DRF para habilitar negociación de contenido text/event-stream."""

    media_type = "text/event-stream"
    format = "sse"
    charset = None


def _build_progress_snapshot(job: ScientificJob) -> JobProgressSnapshot:
    """Construye snapshot tipado y serializable del estado de progreso actual."""
    return {
        "job_id": str(job.id),
        "status": cast(JobStatus, job.status),
        "progress_percentage": int(job.progress_percentage),
        "progress_stage": cast(JobProgressStage, job.progress_stage),
        "progress_message": str(job.progress_message),
        "progress_event_index": int(job.progress_event_index),
        "updated_at": job.updated_at.isoformat().replace("+00:00", "Z"),
    }


def _serialize_sse_progress_event(snapshot: JobProgressSnapshot) -> str:
    """Serializa snapshot a formato Server-Sent Events (SSE)."""
    payload: str = json.dumps(snapshot, ensure_ascii=True, separators=(",", ":"))
    return (
        f"id: {snapshot['progress_event_index']}\n"
        "event: job.progress\n"
        f"data: {payload}\n\n"
    )


def _build_job_log_entry(log_event: ScientificJobLogEvent) -> JobLogEntry:
    """Construye contrato tipado de evento de log por job."""
    return {
        "job_id": str(log_event.job_id),
        "event_index": int(log_event.event_index),
        "level": cast(JobLogLevel, log_event.level),
        "source": str(log_event.source),
        "message": str(log_event.message),
        "payload": cast(JSONMap, log_event.payload),
        "created_at": log_event.created_at.isoformat().replace("+00:00", "Z"),
    }


def _serialize_sse_log_event(log_entry: JobLogEntry) -> str:
    """Serializa evento de log al formato SSE para consumo en tiempo real."""
    payload: str = json.dumps(log_entry, ensure_ascii=True, separators=(",", ":"))
    return f"id: {log_entry['event_index']}\nevent: job.log\ndata: {payload}\n\n"


def _parse_timeout_seconds(raw_timeout_seconds: str | None) -> int:
    """Normaliza timeout de stream SSE dentro de un rango seguro."""
    if raw_timeout_seconds is None:
        return DEFAULT_SSE_TIMEOUT_SECONDS

    try:
        parsed_timeout_seconds: int = int(raw_timeout_seconds)
    except ValueError:
        return DEFAULT_SSE_TIMEOUT_SECONDS

    if parsed_timeout_seconds < 1:
        return 1
    if parsed_timeout_seconds > MAX_SSE_TIMEOUT_SECONDS:
        return MAX_SSE_TIMEOUT_SECONDS
    return parsed_timeout_seconds


def _parse_non_negative_int(raw_value: str | None, default_value: int) -> int:
    """Normaliza query params enteros no negativos con fallback seguro."""
    if raw_value is None:
        return default_value

    try:
        parsed_value: int = int(raw_value)
    except ValueError:
        return default_value

    if parsed_value < 0:
        return default_value
    return parsed_value


@extend_schema(tags=["Jobs"])
class JobViewSet(viewsets.ViewSet):
    """
    Controlador para despachar y consultar Jobs Científicos en el entorno descentralizado.
    La capa HTTP está puramente desacoplada de la ejecución científica real.
    """

    queryset = ScientificJob.objects.all()
    lookup_field = "id"

    @extend_schema(
        summary="Listar Jobs Científicos",
        description=(
            "Devuelve el listado de jobs científicos registrados en todas las apps, "
            "incluyendo su estado actual. Permite filtros opcionales por plugin y estado."
        ),
        parameters=[
            OpenApiParameter(
                name="plugin_name",
                type=str,
                location=OpenApiParameter.QUERY,
                description="Filtra por nombre de plugin/app científica.",
            ),
            OpenApiParameter(
                name="status",
                type=str,
                location=OpenApiParameter.QUERY,
                description=(
                    "Filtra por estado del job. Valores válidos: "
                    "pending, running, paused, completed, failed."
                ),
            ),
        ],
        responses={
            200: ScientificJobSerializer(many=True),
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Filtro de estado inválido.",
                examples=[
                    OpenApiExample(
                        "Estado inválido",
                        value={
                            "detail": "Invalid status filter. Allowed values are: pending, running, paused, completed, "
                            + "failed."
                        },
                    )
                ],
            ),
        },
    )
    def list(self, request: Request) -> Response:
        """Lista jobs de todas las apps con filtros opcionales."""
        plugin_name_filter: str | None = request.query_params.get("plugin_name")
        status_filter: str | None = request.query_params.get("status")

        if (
            status_filter is not None
            and status_filter not in ALLOWED_JOB_STATUS_FILTERS
        ):
            return Response(
                {
                    "detail": (
                        "Invalid status filter. Allowed values are: "
                        "pending, running, paused, completed, failed."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        jobs_queryset = ScientificJob.objects.all().order_by("-created_at")

        if plugin_name_filter:
            jobs_queryset = jobs_queryset.filter(plugin_name=plugin_name_filter)

        if status_filter:
            jobs_queryset = jobs_queryset.filter(status=status_filter)

        result_serializer = ScientificJobSerializer(jobs_queryset, many=True)
        return Response(result_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Despachar Job Científico",
        description=(
            "Evalua reglas de hashing/caching y despacha al worker Celery "
            "solo cuando el job no tiene cache disponible."
        ),
        request=JobCreateSerializer,
        responses={
            201: ScientificJobSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validacion en parametros.",
                examples=[
                    OpenApiExample(
                        "Error plugin no registrado",
                        value={"detail": "Plugin requested is not registered"},
                    )
                ],
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """
        Encola o acierta (Hit) un nuevo Job en cache.
        """
        serializer = JobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data: JobCreatePayload = cast(JobCreatePayload, serializer.validated_data)

        # Desacoplamiento a nivel Services
        job: ScientificJob = JobService.create_job(
            plugin_name=data["plugin_name"],
            version=data["version"],
            parameters=data["parameters"],
        )

        dispatch_result: bool = True
        if job.status == "pending":
            dispatch_result = dispatch_scientific_job(str(job.id))
            JobService.register_dispatch_result(str(job.id), dispatch_result)
            job.refresh_from_db()

        result_serializer = ScientificJobSerializer(job)
        return Response(result_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Estado y Resultados de un Job",
        description="Recupera todo el estado guardado incluyendo outputs una vez finalizado el trabajo subyacente.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job cientifico a consultar.",
            )
        ],
        responses={
            200: ScientificJobSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El trabajo no pudo ser encontrado en el Registry local.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """
        Obtiene un job según su UUID.
        """
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)
        result_serializer = ScientificJobSerializer(job)
        return Response(result_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Solicitar pausa de un Job",
        description=(
            "Solicita pausa cooperativa para un job. Si el job está pending se pausa "
            "de inmediato; si está running queda marcada la pausa y el plugin coopera "
            "en la próxima verificación de control."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            )
        ],
        responses={
            200: JobControlActionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Transición inválida o plugin sin soporte de pausa.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=CORE_JOBS_PAUSE_ROUTE_SUFFIX)
    def pause(self, request: Request, id: str | None = None) -> Response:
        """Solicita pausa cooperativa para un job con soporte explícito."""
        del request
        get_object_or_404(ScientificJob, pk=id)

        try:
            updated_job: ScientificJob = JobService.request_pause(str(id))
        except ValueError as control_error:
            return Response(
                {"detail": str(control_error)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        job_serializer = ScientificJobSerializer(updated_job)
        return Response(
            {
                "detail": "Solicitud de pausa registrada correctamente.",
                "job": job_serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    @extend_schema(
        summary="Reanudar un Job pausado",
        description=(
            "Reanuda un job pausado y lo reencola para continuar desde su estado "
            "persistido cuando el plugin soporta pausa cooperativa."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            )
        ],
        responses={
            200: JobControlActionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Transición inválida o plugin sin soporte de pausa.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=CORE_JOBS_RESUME_ROUTE_SUFFIX)
    def resume(self, request: Request, id: str | None = None) -> Response:
        """Reanuda un job pausado y reintenta su encolado de ejecución."""
        del request
        get_object_or_404(ScientificJob, pk=id)

        try:
            resumed_job: ScientificJob = JobService.resume_job(str(id))
        except ValueError as control_error:
            return Response(
                {"detail": str(control_error)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dispatch_result: bool = dispatch_scientific_job(str(resumed_job.id))
        JobService.register_dispatch_result(str(resumed_job.id), dispatch_result)
        resumed_job.refresh_from_db()

        job_serializer = ScientificJobSerializer(resumed_job)
        detail_message: str = (
            "Job reanudado y encolado correctamente."
            if dispatch_result
            else "Job reanudado pero broker no disponible; permanece pendiente."
        )
        return Response(
            {
                "detail": detail_message,
                "job": job_serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    @extend_schema(
        summary="Consultar progreso de un Job",
        description=(
            "Devuelve un snapshot del progreso actual del job para facilitar "
            "monitorización por polling o reconexión de stream SSE."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico.",
            )
        ],
        responses={
            200: JobProgressSnapshotSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path=CORE_JOBS_PROGRESS_ROUTE_SUFFIX)
    def progress(self, request: Request, id: str | None = None) -> Response:
        """Retorna el progreso actual del job en un contrato tipado y estable."""
        del request
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)
        snapshot: JobProgressSnapshot = _build_progress_snapshot(job)
        serializer = JobProgressSnapshotSerializer(snapshot)
        return Response(serializer.data, status=status.HTTP_200_OK)

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
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)
        after_event_index: int = _parse_non_negative_int(
            request.query_params.get("after_event_index"),
            default_value=0,
        )
        raw_limit: int = _parse_non_negative_int(
            request.query_params.get("limit"),
            default_value=50,
        )
        normalized_limit: int = max(1, min(500, raw_limit if raw_limit > 0 else 50))

        log_events_queryset = ScientificJobLogEvent.objects.filter(
            job=job,
            event_index__gt=after_event_index,
        ).order_by("event_index")[:normalized_limit]

        log_entries: list[JobLogEntry] = [
            _build_job_log_entry(log_event) for log_event in log_events_queryset
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
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)

        last_event_id_header: str | None = request.headers.get("Last-Event-ID")
        last_event_index: int = (
            int(last_event_id_header)
            if last_event_id_header is not None and last_event_id_header.isdigit()
            else 0
        )
        timeout_seconds: int = _parse_timeout_seconds(
            request.query_params.get("timeout_seconds")
        )

        response: StreamingHttpResponse = StreamingHttpResponse(
            self._stream_job_log_events(
                job_id=str(job.id),
                last_event_index=last_event_index,
                timeout_seconds=timeout_seconds,
            ),
            content_type="text/event-stream",
            status=status.HTTP_200_OK,
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

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
    def events(
        self, request: Request, id: str | None = None
    ) -> StreamingHttpResponse:
        """Expone stream SSE de progreso del job con heartbeats de conexión."""
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)

        last_event_id_header: str | None = request.headers.get("Last-Event-ID")
        last_event_index: int = (
            int(last_event_id_header)
            if last_event_id_header is not None and last_event_id_header.isdigit()
            else 0
        )
        timeout_seconds: int = _parse_timeout_seconds(
            request.query_params.get("timeout_seconds")
        )

        response: StreamingHttpResponse = StreamingHttpResponse(
            self._stream_job_events(
                job_id=str(job.id),
                last_event_index=last_event_index,
                timeout_seconds=timeout_seconds,
            ),
            content_type="text/event-stream",
            status=status.HTTP_200_OK,
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

    def _stream_job_events(
        self,
        *,
        job_id: str,
        last_event_index: int,
        timeout_seconds: int,
    ) -> Iterator[str]:
        """Genera eventos SSE de progreso para un job hasta timeout o estado terminal."""
        del self
        started_at: float = monotonic()
        observed_event_index: int = last_event_index
        next_heartbeat_at: float = started_at + 10.0

        try:
            while (monotonic() - started_at) < float(timeout_seconds):
                refreshed_job: ScientificJob | None = ScientificJob.objects.filter(
                    id=job_id
                ).first()

                if refreshed_job is None:
                    yield (
                        "event: job.error\n"
                        'data: {"detail":"Job no encontrado durante stream"}\n\n'
                    )
                    return

                snapshot: JobProgressSnapshot = _build_progress_snapshot(refreshed_job)
                if snapshot["progress_event_index"] > observed_event_index:
                    yield _serialize_sse_progress_event(snapshot)
                    observed_event_index = snapshot["progress_event_index"]

                    if snapshot["status"] in {"completed", "failed", "paused"}:
                        return

                now: float = monotonic()
                if now >= next_heartbeat_at:
                    yield ": keep-alive\n\n"
                    next_heartbeat_at = now + 10.0

                sleep(SSE_POLL_INTERVAL_SECONDS)

            if observed_event_index == last_event_index:
                final_job: ScientificJob | None = ScientificJob.objects.filter(
                    id=job_id
                ).first()
                if final_job is not None:
                    yield _serialize_sse_progress_event(
                        _build_progress_snapshot(final_job)
                    )
        except (GeneratorExit, BrokenPipeError, ConnectionResetError):
            return

    def _stream_job_log_events(
        self,
        *,
        job_id: str,
        last_event_index: int,
        timeout_seconds: int,
    ) -> Iterator[str]:
        """Genera eventos SSE de logs de job hasta timeout o fin de ejecución."""
        del self
        started_at: float = monotonic()
        observed_event_index: int = last_event_index
        next_heartbeat_at: float = started_at + 10.0

        try:
            while (monotonic() - started_at) < float(timeout_seconds):
                refreshed_job: ScientificJob | None = ScientificJob.objects.filter(
                    id=job_id
                ).first()

                if refreshed_job is None:
                    yield (
                        "event: job.error\n"
                        'data: {"detail":"Job no encontrado durante stream"}\n\n'
                    )
                    return

                pending_events = ScientificJobLogEvent.objects.filter(
                    job_id=job_id,
                    event_index__gt=observed_event_index,
                ).order_by("event_index")

                for pending_event in pending_events:
                    log_entry: JobLogEntry = _build_job_log_entry(pending_event)
                    yield _serialize_sse_log_event(log_entry)
                    observed_event_index = pending_event.event_index

                if refreshed_job.status in {"completed", "failed", "paused"}:
                    return

                now: float = monotonic()
                if now >= next_heartbeat_at:
                    yield ": keep-alive\n\n"
                    next_heartbeat_at = now + 10.0

                sleep(SSE_POLL_INTERVAL_SECONDS)
        except (GeneratorExit, BrokenPipeError, ConnectionResetError):
            return

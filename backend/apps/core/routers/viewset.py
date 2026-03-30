"""routers/viewset.py: ViewSet HTTP para jobs científicos.

Endpoints REST para crear, consultar, controlar (pause/resume/cancel)
y monitorear jobs científicos via polling y SSE streaming.
"""

from typing import cast

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
from rest_framework.request import Request
from rest_framework.response import Response

from ..definitions import (
    ALLOWED_JOB_STATUS_FILTERS,
    CORE_JOBS_CANCEL_ROUTE_SUFFIX,
    CORE_JOBS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_EVENTS_ROUTE_SUFFIX,
    CORE_JOBS_LOGS_ROUTE_SUFFIX,
    CORE_JOBS_PAUSE_ROUTE_SUFFIX,
    CORE_JOBS_PROGRESS_ROUTE_SUFFIX,
    CORE_JOBS_RESUME_ROUTE_SUFFIX,
    DEFAULT_SSE_TIMEOUT_SECONDS,
)
from ..models import ScientificJob, ScientificJobLogEvent
from ..schemas import (
    ErrorResponseSerializer,
    JobControlActionResponseSerializer,
    JobCreateSerializer,
    JobLogListSerializer,
    JobProgressSnapshotSerializer,
    ScientificJobSerializer,
)
from ..services import JobService
from ..tasks import dispatch_scientific_job
from ..types import (
    JobCreatePayload,
    JobLogEntry,
    JobLogListResponse,
    JobProgressSnapshot,
)
from .helpers import (
    ServerSentEventsRenderer,
    build_job_log_entry,
    build_progress_snapshot,
    parse_non_negative_int,
    parse_timeout_seconds,
)
from .streaming import stream_job_events, stream_job_log_events


@extend_schema(tags=["Jobs"])
class JobViewSet(viewsets.ViewSet):
    """Controlador para despachar y consultar Jobs Científicos."""

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
                        "pending, running, paused, completed, failed, cancelled."
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
        """Encola o acierta (Hit) un nuevo Job en cache."""
        serializer = JobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data: JobCreatePayload = cast(JobCreatePayload, serializer.validated_data)

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
        """Obtiene un job según su UUID."""
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
        summary="Cancelar un Job (irreversible)",
        description=(
            "Cancela un job en estado pending, running o paused de forma inmediata e "
            "irreversible. No es posible reactivar un job cancelado. Los jobs en estado "
            "completed, failed o cancelled no pueden ser cancelados."
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
                description="El job está en estado terminal y no puede cancelarse.",
                examples=[
                    OpenApiExample(
                        "Job ya finalizado",
                        value={
                            "detail": "No es posible cancelar un job en estado terminal (estado actual: completed)."
                        },
                    )
                ],
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=CORE_JOBS_CANCEL_ROUTE_SUFFIX)
    def cancel(self, request: Request, id: str | None = None) -> Response:
        """Cancela un job de forma irreversible si se encuentra en estado activo."""
        del request
        get_object_or_404(ScientificJob, pk=id)

        try:
            cancelled_job: ScientificJob = JobService.cancel_job(str(id))
        except ValueError as control_error:
            return Response(
                {"detail": str(control_error)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        job_serializer = ScientificJobSerializer(cancelled_job)
        return Response(
            {
                "detail": "Job cancelado correctamente. La operación es irreversible.",
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
        snapshot: JobProgressSnapshot = build_progress_snapshot(job)
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
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)

        last_event_id_header: str | None = request.headers.get("Last-Event-ID")
        last_event_index: int = (
            int(last_event_id_header)
            if last_event_id_header is not None and last_event_id_header.isdigit()
            else 0
        )
        timeout_seconds: int = parse_timeout_seconds(
            request.query_params.get("timeout_seconds")
        )

        response: StreamingHttpResponse = StreamingHttpResponse(
            stream_job_log_events(
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
    def events(self, request: Request, id: str | None = None) -> StreamingHttpResponse:
        """Expone stream SSE de progreso del job con heartbeats de conexión."""
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)

        last_event_id_header: str | None = request.headers.get("Last-Event-ID")
        last_event_index: int = (
            int(last_event_id_header)
            if last_event_id_header is not None and last_event_id_header.isdigit()
            else 0
        )
        timeout_seconds: int = parse_timeout_seconds(
            request.query_params.get("timeout_seconds")
        )

        response: StreamingHttpResponse = StreamingHttpResponse(
            stream_job_events(
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

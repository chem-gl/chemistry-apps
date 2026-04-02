"""_job_control_mixin.py: Acciones de control de estado para Jobs Científicos.

Objetivo del archivo:
- Proveer mixin con endpoints pause, resume, cancel y progress para JobViewSet.
- Encapsula la lógica de transición de estado y sus contratos OpenAPI.

Cómo se usa:
- `JobViewSet` en `viewset.py` hereda de `JobControlActionsMixin`.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
)
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from ..definitions import (
    CORE_JOBS_CANCEL_ROUTE_SUFFIX,
    CORE_JOBS_PAUSE_ROUTE_SUFFIX,
    CORE_JOBS_PROGRESS_ROUTE_SUFFIX,
    CORE_JOBS_RESUME_ROUTE_SUFFIX,
)
from ..models import ScientificJob
from ..schemas import (
    ErrorResponseSerializer,
    JobControlActionResponseSerializer,
    JobProgressSnapshotSerializer,
    ScientificJobSerializer,
)
from ..services import JobService
from ..tasks import dispatch_scientific_job
from ..types import JobProgressSnapshot
from .helpers import build_progress_snapshot


class JobControlActionsMixin:
    """Mixin con acciones de control de estado (pause, resume, cancel, progress)."""

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

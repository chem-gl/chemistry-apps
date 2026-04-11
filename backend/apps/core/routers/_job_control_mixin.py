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
    CORE_JOBS_DELETE_ROUTE_SUFFIX,
    CORE_JOBS_PAUSE_ROUTE_SUFFIX,
    CORE_JOBS_PROGRESS_ROUTE_SUFFIX,
    CORE_JOBS_RESTORE_ROUTE_SUFFIX,
    CORE_JOBS_RESUME_ROUTE_SUFFIX,
)
from ..identity.services import AuthorizationService
from ..models import ScientificJob
from ..schemas import (
    ErrorResponseSerializer,
    JobControlActionResponseSerializer,
    JobDeleteActionResponseSerializer,
    JobProgressSnapshotSerializer,
    ScientificJobSerializer,
)
from ..services import JobService
from ..tasks import dispatch_scientific_job
from ..types import JobProgressSnapshot
from .helpers import build_progress_snapshot


class JobControlActionsMixin:
    """Mixin con acciones de control de estado (pause, resume, cancel, progress)."""

    def _get_active_job_or_404(self, job_id: str | None) -> ScientificJob:
        """Recupera un job visible para endpoints normales, excluyendo papelera."""
        return get_object_or_404(
            ScientificJob.objects.filter(deleted_at__isnull=True),
            pk=job_id,
        )

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
        actor = request.user
        job = self._get_active_job_or_404(id)
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_manage_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para pausar este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

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
        actor = request.user
        job = self._get_active_job_or_404(id)
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_manage_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para reanudar este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

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
        actor = request.user
        job = self._get_active_job_or_404(id)
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_manage_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para cancelar este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

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
        summary="Eliminar un Job",
        description=(
            "Usuarios estándar eliminan definitivamente sus jobs terminales. "
            "Root/Admin siempre envían primero a papelera y desde ahí pueden restaurar "
            "o eliminar definitivamente antes del vencimiento automático."
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
            200: JobDeleteActionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El job ya está en papelera o aún debe cancelarse antes.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=CORE_JOBS_DELETE_ROUTE_SUFFIX)
    def delete(self, request: Request, id: str | None = None) -> Response:
        """Elimina un job según rol y estado de papelera."""
        actor = request.user
        if not bool(getattr(actor, "is_authenticated", False)):
            return Response(
                {"detail": "Debes autenticarte para eliminar jobs."},
                status=status.HTTP_403_FORBIDDEN,
            )

        job = get_object_or_404(ScientificJob, pk=id)
        if not AuthorizationService.can_delete_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para eliminar este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            deletion_result = JobService.delete_job(str(id), actor=actor)
        except ValueError as control_error:
            return Response(
                {"detail": str(control_error)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        detail_message = (
            "Job eliminado definitivamente."
            if deletion_result["deletion_mode"] == "hard"
            else "Job enviado a la papelera de reciclaje."
        )
        return Response(
            {
                "detail": detail_message,
                "job_id": deletion_result["job_id"],
                "deletion_mode": deletion_result["deletion_mode"],
                "scheduled_hard_delete_at": deletion_result["scheduled_hard_delete_at"],
            },
            status=status.HTTP_200_OK,
        )

    @extend_schema(
        summary="Restaurar un Job desde papelera",
        description=(
            "Permite a root o administradores restaurar jobs eliminados lógicamente "
            "dentro de su ámbito autorizado."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job científico enviado a papelera.",
            )
        ],
        responses={
            200: JobControlActionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El job no está en papelera o no puede restaurarse.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
            ),
        },
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=CORE_JOBS_RESTORE_ROUTE_SUFFIX)
    def restore(self, request: Request, id: str | None = None) -> Response:
        """Restaura un job enviado a papelera lógica dentro del alcance autorizado."""
        actor = request.user
        if not bool(getattr(actor, "is_authenticated", False)):
            return Response(
                {"detail": "Debes autenticarte para restaurar jobs."},
                status=status.HTTP_403_FORBIDDEN,
            )

        job = get_object_or_404(ScientificJob, pk=id)
        if not AuthorizationService.can_restore_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para restaurar este job."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            restored_job = JobService.restore_job(str(id), actor=actor)
        except ValueError as control_error:
            return Response(
                {"detail": str(control_error)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        job_serializer = ScientificJobSerializer(restored_job)
        return Response(
            {
                "detail": "Job restaurado correctamente desde la papelera.",
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
        actor = request.user
        job: ScientificJob = self._get_active_job_or_404(id)
        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_view_job(actor=actor, job=job):
            return Response(
                {"detail": "No tienes permisos para ver el progreso de este job."},
                status=status.HTTP_403_FORBIDDEN,
            )
        snapshot: JobProgressSnapshot = build_progress_snapshot(job)
        serializer = JobProgressSnapshotSerializer(snapshot)
        return Response(serializer.data, status=status.HTTP_200_OK)

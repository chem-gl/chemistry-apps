"""routers/viewset.py: ViewSet HTTP para jobs científicos.

Endpoints REST para crear, consultar, controlar (pause/resume/cancel)
y monitorear jobs científicos via polling y SSE streaming.

Composición por mixins:
- `JobControlActionsMixin` (_job_control_mixin.py): pause, resume, cancel, progress.
- `JobStreamActionsMixin` (_job_stream_mixin.py): logs, logs_events, events.
"""

from typing import cast

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
)
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from ..definitions import ALLOWED_JOB_STATUS_FILTERS
from ..identity.services import AuthorizationService
from ..models import ScientificJob
from ..schemas import (
    ErrorResponseSerializer,
    JobCreateSerializer,
    ScientificJobSerializer,
)
from ..services import JobService
from ..tasks import dispatch_scientific_job
from ..types import JobCreatePayload
from ._job_control_mixin import JobControlActionsMixin
from ._job_stream_mixin import JobStreamActionsMixin


@extend_schema(tags=["Jobs"])
class JobViewSet(JobControlActionsMixin, JobStreamActionsMixin, viewsets.ViewSet):
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

        request_user = request.user
        if bool(getattr(request_user, "is_authenticated", False)):
            jobs_queryset = AuthorizationService.get_visible_jobs(request_user)
        else:
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

        actor = (
            request.user
            if bool(getattr(request.user, "is_authenticated", False))
            else None
        )
        owner_id = actor.id if actor is not None else None
        group_id = (
            AuthorizationService.get_primary_group_id(actor)
            if actor is not None
            else None
        )

        job: ScientificJob = JobService.create_job(
            plugin_name=data["plugin_name"],
            version=data["version"],
            parameters=data["parameters"],
            owner_id=owner_id,
            group_id=group_id,
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
        request_user = request.user
        job: ScientificJob = get_object_or_404(ScientificJob, pk=id)
        if bool(getattr(request_user, "is_authenticated", False)):
            if not AuthorizationService.can_view_job(request_user, job):
                return Response(
                    {"detail": "No tienes permisos para ver este job."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        result_serializer = ScientificJobSerializer(job)
        return Response(result_serializer.data, status=status.HTTP_200_OK)

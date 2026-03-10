"""routers.py: Endpoints HTTP desacoplados que orquestan servicios core."""

from typing import Optional, cast

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

from .definitions import ALLOWED_JOB_STATUS_FILTERS
from .models import ScientificJob
from .schemas import (
    ErrorResponseSerializer,
    JobCreateSerializer,
    ScientificJobSerializer,
)
from .services import JobService
from .tasks import dispatch_scientific_job
from .types import JobCreatePayload


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
                    "pending, running, completed, failed."
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
                            "detail": "Invalid status filter. Allowed values are: pending, running, completed, failed."
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
                        "pending, running, completed, failed."
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

        # Iniciar proceso Background si no acertó la caché temprana y el job fue realmente creado virgen
        if job.status == "pending":
            dispatch_scientific_job(str(job.id))

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
    def retrieve(self, request: Request, id: Optional[str] = None) -> Response:
        """
        Obtiene un job según su UUID.
        """
        job = get_object_or_404(ScientificJob, pk=id)
        result_serializer = ScientificJobSerializer(job)
        return Response(result_serializer.data, status=status.HTTP_200_OK)

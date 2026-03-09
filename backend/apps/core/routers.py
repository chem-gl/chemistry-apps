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

from .models import ScientificJob
from .schemas import (
    ErrorResponseSerializer,
    JobCreateSerializer,
    ScientificJobSerializer,
)
from .services import JobService
from .tasks import execute_scientific_job
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
            execute_scientific_job.delay(str(job.id))

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

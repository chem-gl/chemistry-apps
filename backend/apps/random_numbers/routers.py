"""routers.py: Endpoints de la app random_numbers sobre el núcleo de jobs."""

from typing import cast

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from .definitions import PLUGIN_NAME
from .schemas import (
    RandomNumbersJobCreateSerializer,
    RandomNumbersJobResponseSerializer,
)
from .types import RandomNumbersJobCreatePayload


@extend_schema(tags=["RandomNumbers"])
class RandomNumbersJobViewSet(viewsets.ViewSet):
    """Expone endpoints dedicados para generación de números aleatorios."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Crear Job de Números Aleatorios",
        description=(
            "Crea un job asíncrono que genera números aleatorios por lotes "
            "según una URL semilla y un intervalo en segundos."
        ),
        request=RandomNumbersJobCreateSerializer,
        responses={
            201: RandomNumbersJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato random_numbers.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea y despacha un job random_numbers preservando trazabilidad de progreso."""
        serializer = RandomNumbersJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: RandomNumbersJobCreatePayload = cast(
            RandomNumbersJobCreatePayload,
            serializer.validated_data,
        )

        version_value: str = validated_payload["version"]
        parameters_payload: JSONMap = {
            "seed_url": validated_payload["seed_url"],
            "numbers_per_batch": validated_payload["numbers_per_batch"],
            "interval_seconds": validated_payload["interval_seconds"],
            "total_numbers": validated_payload["total_numbers"],
        }

        declarative_api = DeclarativeJobAPI(
            dispatch_callback=dispatch_scientific_job,
        )
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=version_value,
            parameters=parameters_payload,
        ).run()

        if submit_result.is_failure():
            error_message: str = submit_result.fold(
                on_failure=lambda error_value: str(error_value),
                on_success=lambda _: "Error desconocido al crear el job.",
            )
            return Response(
                {"detail": error_message},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        job_handle = submit_result.get_or_else(None)
        if job_handle is None:
            return Response(
                {"detail": "No se pudo obtener el handle del job creado."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=job_handle.job_id,
            plugin_name=PLUGIN_NAME,
        )

        response_serializer = RandomNumbersJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Números Aleatorios",
        description="Devuelve estado y resultado de random_numbers por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job random_numbers.",
            )
        ],
        responses={
            200: RandomNumbersJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job random_numbers no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera un job random_numbers filtrando por plugin dedicado."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = RandomNumbersJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

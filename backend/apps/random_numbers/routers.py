"""routers.py: Endpoints de la app random_numbers sobre el núcleo de jobs.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define solo:
1. create() con validación propia de random_numbers.
2. build_csv_content() con formato CSV específico de esta app.
"""

from typing import cast

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.reporting import escape_csv_cell
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import (
    RandomNumbersJobCreateSerializer,
    RandomNumbersJobResponseSerializer,
)
from .types import RandomNumbersJobCreatePayload, RandomNumbersResult


@extend_schema(tags=["RandomNumbers"])
class RandomNumbersJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints HTTP de random_numbers. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = RandomNumbersJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV con índice secuencial y número generado por el plugin."""
        results_payload: RandomNumbersResult = cast(RandomNumbersResult, job.results)
        generated_numbers: list[int] = results_payload["generated_numbers"]

        csv_lines: list[str] = ["index,generated_number"]
        for index_value, generated_value in enumerate(generated_numbers, start=1):
            csv_lines.append(
                ",".join(
                    [
                        escape_csv_cell(str(index_value)),
                        escape_csv_cell(str(generated_value)),
                    ]
                )
            )

        return "\n".join(csv_lines)

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

        return self.handle_submit_result(
            submit_result, RandomNumbersJobResponseSerializer
        )

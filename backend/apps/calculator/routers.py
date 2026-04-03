"""routers.py: Endpoints de calculadora con contrato estricto por app.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define solo:
1. create() con validación propia de calculadora.
2. build_csv_content() con formato CSV específico de esta app.
"""

from typing import cast

from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
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
from .schemas import CalculatorJobCreateSerializer, CalculatorJobResponseSerializer
from .types import CalculatorJobCreatePayload, CalculatorResult


@extend_schema(tags=["Calculator"])
class CalculatorJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints HTTP de calculadora. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = CalculatorJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV de una fila con operación, operandos y resultado final."""
        results_payload: CalculatorResult = cast(CalculatorResult, job.results)
        metadata_payload = results_payload["metadata"]

        operand_b_value: str = ""
        if metadata_payload["operand_b"] is not None:
            operand_b_value = f"{float(metadata_payload['operand_b']):.10f}"

        csv_header: str = "operation,operand_a,operand_b,final_result"
        csv_row_values: list[str] = [
            str(metadata_payload["operation_used"]),
            f"{float(metadata_payload['operand_a']):.10f}",
            operand_b_value,
            f"{float(results_payload['final_result']):.10f}",
        ]
        csv_row: str = ",".join(
            escape_csv_cell(cell_value) for cell_value in csv_row_values
        )
        return "\n".join([csv_header, csv_row])

    @extend_schema(
        summary="Crear Job de Calculadora",
        description=(
            "Recibe parámetros estrictos de calculadora y despacha el trabajo "
            "en background cuando no existe caché."
        ),
        request=CalculatorJobCreateSerializer,
        responses={
            201: CalculatorJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de calculadora.",
                examples=[
                    OpenApiExample(
                        "Factorial inválido",
                        value={
                            "a": ["Para factorial, a debe ser un entero no negativo."]
                        },
                    ),
                    OpenApiExample(
                        "Operación binaria sin b",
                        value={
                            "b": [
                                "El campo b es obligatorio para operaciones binarias."
                            ]
                        },
                    ),
                ],
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea un job de calculadora y registra trazabilidad de encolado."""
        serializer = CalculatorJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: CalculatorJobCreatePayload = cast(
            CalculatorJobCreatePayload, serializer.validated_data
        )
        version_value: str = validated_payload["version"]

        parameters_payload: JSONMap = {
            "op": validated_payload["op"],
            "a": validated_payload["a"],
        }
        second_operand_value: float | None = validated_payload.get("b")
        if second_operand_value is not None:
            parameters_payload["b"] = second_operand_value

        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=version_value,
            parameters=parameters_payload,
        ).run()

        return self.handle_submit_result(submit_result, CalculatorJobResponseSerializer)

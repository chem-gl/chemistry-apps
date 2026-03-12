"""routers.py: Endpoints de calculadora con contrato estricto por app.

Este módulo muestra el patrón recomendado para apps científicas basadas en
`apps.core`:
1. Validar request con serializer propio de app.
2. Delegar creación de job a `JobService`.
3. Delegar encolado a `dispatch_scientific_job`.
4. Mantener el router sin lógica matemática de dominio.
"""

from typing import cast

from django.http import HttpResponse
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

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.reporting import (
    build_download_filename,
    build_job_error_report,
    build_job_log_report,
    build_text_download_response,
    validate_job_for_csv_report,
)
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import CalculatorJobCreateSerializer, CalculatorJobResponseSerializer
from .types import CalculatorJobCreatePayload, CalculatorResult


def _escape_csv_cell(raw_value: str) -> str:
    """Escapa una celda CSV para preservar estructura al descargar."""
    escaped_value: str = raw_value.replace('"', '""')
    if any(separator in escaped_value for separator in [",", "\n", "\r", '"']):
        return f'"{escaped_value}"'
    return escaped_value


def _build_calculator_csv(job: ScientificJob) -> str:
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
        _escape_csv_cell(cell_value) for cell_value in csv_row_values
    )
    return "\n".join([csv_header, csv_row])


@extend_schema(tags=["Calculator"])
class CalculatorJobViewSet(viewsets.ViewSet):
    """Expone endpoints HTTP por app para crear/consultar jobs de calculadora.

    Esta capa se limita a orquestar el contrato HTTP y delega la ejecución real
    a servicios del núcleo core.
    """

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

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
        """Crea un job de calculadora y registra trazabilidad de encolado.

        Si el broker está disponible, el job pasa a cola asíncrona; de lo
        contrario, queda pendiente con mensaje explícito de progreso.
        """
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

        response_serializer = CalculatorJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Calculadora",
        description="Devuelve estado y resultado del job de calculadora por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job de calculadora.",
            )
        ],
        responses={
            200: CalculatorJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de calculadora no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera un job de calculadora existente por id.

        Este endpoint es app-específico y filtra por `plugin_name=calculator`
        para evitar fugas de jobs de otras apps científicas.
        """
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = CalculatorJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV de Calculadora",
        description=(
            "Descarga un CSV con operación usada, operandos y resultado final. "
            "Solo aplica para jobs en estado completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV construido desde resultados del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de calculadora no encontrado.",
            ),
            409: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El estado del job no permite exportación CSV.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-csv")
    def report_csv(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega CSV de resultado de calculadora cuando el job está completed."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        validation_error: str | None = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error},
                status=status.HTTP_409_CONFLICT,
            )

        csv_content: str = _build_calculator_csv(job)
        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="report",
            extension="csv",
        )
        return build_text_download_response(
            content=csv_content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Reporte LOG de Calculadora",
        description=(
            "Descarga un log técnico con parámetros de entrada, estado, "
            "resultados y eventos de ejecución."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con trazabilidad del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de calculadora no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual de auditoría para el job solicitado."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_calculator_csv(job)

        report_content: str = build_job_log_report(job=job, csv_content=csv_content)
        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="report",
            extension="log",
        )
        return build_text_download_response(
            content=report_content,
            filename=filename,
            content_type="text/plain; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Reporte de Error de Calculadora",
        description=(
            "Descarga un reporte de error para jobs failed con error_trace. "
            "Incluye parámetros de entrada y detalle del fallo."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con contexto del error.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de calculadora no encontrado.",
            ),
            409: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El job no tiene un error exportable.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-error")
    def report_error(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega reporte de error cuando el job terminó en failed."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        error_report: str | None = build_job_error_report(job)
        if error_report is None:
            return Response(
                {
                    "detail": (
                        "El reporte de error solo está disponible para jobs failed "
                        "con error_trace persistido."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="error",
            extension="log",
        )
        return build_text_download_response(
            content=error_report,
            filename=filename,
            content_type="text/plain; charset=utf-8",
        )

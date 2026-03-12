"""routers.py: Endpoints de la app random_numbers sobre el núcleo de jobs.

Objetivo del archivo:
- Exponer endpoints de creación/consulta para random_numbers sin mezclar lógica
    matemática o de infraestructura en la capa HTTP.

Cómo se usa:
1. Validar request con serializer propio de app.
2. Delegar creación y encolado a `DeclarativeJobAPI` + `dispatch_scientific_job`.
3. Responder con serializer de salida desacoplado del ORM directo.
"""

from typing import cast

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
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
from .schemas import (
    RandomNumbersJobCreateSerializer,
    RandomNumbersJobResponseSerializer,
)
from .types import RandomNumbersJobCreatePayload, RandomNumbersResult


def _escape_csv_cell(raw_value: str) -> str:
    """Escapa una celda CSV para mantener formato válido al descargar."""
    escaped_value: str = raw_value.replace('"', '""')
    if any(separator in escaped_value for separator in [",", "\n", "\r", '"']):
        return f'"{escaped_value}"'
    return escaped_value


def _build_random_numbers_csv(job: ScientificJob) -> str:
    """Construye CSV con índice secuencial y número generado por el plugin."""
    results_payload: RandomNumbersResult = cast(RandomNumbersResult, job.results)
    generated_numbers: list[int] = results_payload["generated_numbers"]

    csv_lines: list[str] = ["index,generated_number"]
    for index_value, generated_value in enumerate(generated_numbers, start=1):
        csv_lines.append(
            ",".join(
                [
                    _escape_csv_cell(str(index_value)),
                    _escape_csv_cell(str(generated_value)),
                ]
            )
        )

    return "\n".join(csv_lines)


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

    @extend_schema(
        summary="Descargar Reporte CSV de Random Numbers",
        description=(
            "Descarga un CSV con índice secuencial y números generados. "
            "Solo aplica para jobs en estado completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV construido desde resultados del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job random_numbers no encontrado.",
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
        """Entrega CSV de resultados para jobs completed de random_numbers."""
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

        csv_content: str = _build_random_numbers_csv(job)
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
        summary="Descargar Reporte LOG de Random Numbers",
        description=(
            "Descarga un log técnico con parámetros, resultados, eventos y CSV "
            "embebido cuando el job ya está completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con trazabilidad del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job random_numbers no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual unificado para auditoría de ejecución."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_random_numbers_csv(job)

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
        summary="Descargar Reporte de Error de Random Numbers",
        description=(
            "Descarga un reporte de error para jobs failed con error_trace. "
            "Incluye parámetros de entrada y traza de fallo."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con detalle del error del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job random_numbers no encontrado.",
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
        """Entrega reporte de error para jobs fallidos con traza persistida."""
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

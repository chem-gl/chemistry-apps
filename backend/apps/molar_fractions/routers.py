"""routers.py: Endpoints HTTP dedicados para molar_fractions.

Objetivo del archivo:
- Exponer creación/consulta de jobs sin mezclar lógica científica en la capa API.

Cómo se usa:
1. Validar request con serializer de la app.
2. Delegar creación a `DeclarativeJobAPI`.
3. Encolar con `dispatch_scientific_job` y responder contrato tipado.
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
    MolarFractionsJobCreateSerializer,
    MolarFractionsJobResponseSerializer,
)
from .types import MolarFractionsJobCreatePayload, MolarFractionsResult


def _escape_csv_cell(raw_value: str) -> str:
    """Escapa una celda CSV para soportar comas, comillas y saltos de línea."""
    escaped_value: str = raw_value.replace('"', '""')
    if any(separator in escaped_value for separator in [",", "\n", "\r", '"']):
        return f'"{escaped_value}"'
    return escaped_value


def _build_molar_fractions_csv(job: ScientificJob) -> str:
    """Construye el CSV tabular de resultados para un job de molar_fractions."""
    results_payload: MolarFractionsResult = cast(MolarFractionsResult, job.results)
    species_labels: list[str] = results_payload["species_labels"]
    rows_payload = results_payload["rows"]

    csv_lines: list[str] = [
        ",".join(["ph", *species_labels, "sum_fraction"]),
    ]

    for row in rows_payload:
        fractions_payload: list[float] = row["fractions"]
        row_cells: list[str] = [
            f"{float(row['ph']):.6f}",
            *[f"{float(value):.10f}" for value in fractions_payload],
            f"{float(row['sum_fraction']):.10f}",
        ]
        csv_lines.append(
            ",".join(_escape_csv_cell(cell_value) for cell_value in row_cells)
        )

    return "\n".join(csv_lines)


@extend_schema(tags=["MolarFractions"])
class MolarFractionsJobViewSet(viewsets.ViewSet):
    """Expone endpoints de fracciones molares para ejecución asíncrona."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Crear Job de Molar Fractions",
        description=(
            "Crea un job asíncrono para calcular fracciones molares f0..fn en "
            "un pH único o en un rango de pH."
        ),
        request=MolarFractionsJobCreateSerializer,
        responses={
            201: MolarFractionsJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de molar_fractions.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job molar_fractions y conserva trazabilidad de encolado."""
        serializer = MolarFractionsJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: MolarFractionsJobCreatePayload = cast(
            MolarFractionsJobCreatePayload,
            serializer.validated_data,
        )

        version_value: str = validated_payload["version"]
        ph_mode: str = validated_payload["ph_mode"]

        parameters_payload: JSONMap = {
            "pka_values": validated_payload["pka_values"],
            "ph_mode": ph_mode,
        }
        if ph_mode == "single":
            parameters_payload["ph_value"] = validated_payload["ph_value"]
        else:
            parameters_payload["ph_min"] = validated_payload["ph_min"]
            parameters_payload["ph_max"] = validated_payload["ph_max"]
            parameters_payload["ph_step"] = validated_payload["ph_step"]

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

        response_serializer = MolarFractionsJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Molar Fractions",
        description="Devuelve estado, progreso y resultados del job por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job de molar_fractions.",
            )
        ],
        responses={
            200: MolarFractionsJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de molar_fractions no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera job por UUID filtrando por plugin molar_fractions."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = MolarFractionsJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV de Molar Fractions",
        description=(
            "Descarga un CSV con filas de pH, columnas f0..fn y sum_fraction. "
            "Solo aplica para jobs en estado completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV generado a partir de resultados del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de molar_fractions no encontrado.",
            ),
            409: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El estado del job no permite exportación CSV.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-csv")
    def report_csv(self, request: Request, id: str | None = None) -> HttpResponse | Response:
        """Entrega un CSV de resultados cuando el job terminó correctamente."""
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

        csv_content: str = _build_molar_fractions_csv(job)
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
        summary="Descargar Reporte LOG de Molar Fractions",
        description=(
            "Descarga un log técnico con metadata del job, parámetros de entrada, "
            "snapshot de resultados y eventos persistidos. Si el job está completed, "
            "incluye además un bloque CSV embebido."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con trazabilidad completa del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de molar_fractions no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual consolidado con parámetros, logs y CSV opcional."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_molar_fractions_csv(job)

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
        summary="Descargar Reporte de Error de Molar Fractions",
        description=(
            "Descarga un reporte de error con parámetros de entrada y traza de fallo. "
            "Solo aplica para jobs en estado failed con error_trace persistido."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con detalle del fallo del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de molar_fractions no encontrado.",
            ),
            409: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="El job no tiene un error exportable.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-error")
    def report_error(self, request: Request, id: str | None = None) -> HttpResponse | Response:
        """Entrega reporte de error para jobs fallidos con traza disponible."""
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

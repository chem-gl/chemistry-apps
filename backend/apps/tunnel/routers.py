"""routers.py: Endpoints HTTP dedicados para la app Tunnel.

Objetivo del archivo:
- Exponer creación/consulta de jobs de Tunnel sin mezclar lógica científica.

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
from .schemas import TunnelJobCreateSerializer, TunnelJobResponseSerializer
from .types import TunnelCalculationResult, TunnelJobCreatePayload


def _build_tunnel_csv(job: ScientificJob) -> str:
    """Construye CSV tabular de entradas y salidas del cálculo Tunnel."""
    result_payload: TunnelCalculationResult = cast(TunnelCalculationResult, job.results)

    parameters_payload: JSONMap = cast(JSONMap, job.parameters)
    csv_lines: list[str] = [
        (
            "reaction_barrier_zpe,imaginary_frequency,reaction_energy_zpe,temperature,"
            "u,alpha_1,alpha_2,g,kappa_tst"
        ),
        (
            f"{float(parameters_payload['reaction_barrier_zpe']):.8f},"
            f"{float(parameters_payload['imaginary_frequency']):.8f},"
            f"{float(parameters_payload['reaction_energy_zpe']):.8f},"
            f"{float(parameters_payload['temperature']):.8f},"
            f"{float(result_payload['u']):.8f},"
            f"{float(result_payload['alpha_1']):.8f},"
            f"{float(result_payload['alpha_2']):.8f},"
            f"{float(result_payload['g']):.8f},"
            f"{float(result_payload['kappa_tst']):.8f}"
        ),
    ]

    return "\n".join(csv_lines)


@extend_schema(tags=["Tunnel"])
class TunnelJobViewSet(viewsets.ViewSet):
    """Expone endpoints de Tunnel para ejecución asíncrona."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Crear Job de Tunnel",
        description=(
            "Crea un job asíncrono para calcular el efecto túnel usando teoría "
            "de Eckart asimétrica y librería CK_TEST."
        ),
        request=TunnelJobCreateSerializer,
        responses={
            201: TunnelJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de Tunnel.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job de Tunnel preservando trazabilidad de parámetros de entrada."""
        serializer = TunnelJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: TunnelJobCreatePayload = cast(
            TunnelJobCreatePayload,
            serializer.validated_data,
        )

        parameters_payload: JSONMap = {
            "reaction_barrier_zpe": validated_payload["reaction_barrier_zpe"],
            "imaginary_frequency": validated_payload["imaginary_frequency"],
            "reaction_energy_zpe": validated_payload["reaction_energy_zpe"],
            "temperature": validated_payload["temperature"],
            "input_change_events": validated_payload["input_change_events"],
        }

        declarative_api = DeclarativeJobAPI(
            dispatch_callback=dispatch_scientific_job,
        )
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=validated_payload["version"],
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

        response_serializer = TunnelJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Tunnel",
        description="Devuelve estado, progreso y resultados del job por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job de Tunnel.",
            )
        ],
        responses={
            200: TunnelJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de Tunnel no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera job Tunnel por UUID filtrando por plugin."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = TunnelJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV de Tunnel",
        description=(
            "Descarga CSV con entradas del cálculo y salida final (U, Alpha1, Alpha2, G, Kappa). "
            "Solo aplica para jobs completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV generado a partir del job Tunnel.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de Tunnel no encontrado.",
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
        """Entrega CSV de resultados para jobs Tunnel completados."""
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

        csv_content: str = _build_tunnel_csv(job)
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
        summary="Descargar Reporte LOG de Tunnel",
        description=(
            "Descarga un log técnico con parámetros, resultados y eventos de entrada "
            "capturados para auditoría del cálculo Tunnel."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con trazabilidad completa del job Tunnel.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de Tunnel no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual consolidado con trazabilidad de job Tunnel."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_tunnel_csv(job)

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
        summary="Descargar Reporte de Error de Tunnel",
        description=(
            "Descarga reporte de error con parámetros de entrada y traza de fallo. "
            "Solo aplica para jobs failed con error_trace persistido."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con detalle del fallo del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de Tunnel no encontrado.",
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
        """Entrega reporte de error para jobs Tunnel fallidos."""
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
                        "con traza de error persistida."
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

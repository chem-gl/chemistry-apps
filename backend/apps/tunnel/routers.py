"""routers.py: Endpoints HTTP dedicados para la app Tunnel.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define solo:
1. create() con validación propia de Tunnel.
2. build_csv_content() con formato CSV de entradas/salidas Eckart.
"""

from typing import cast

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import TunnelJobCreateSerializer, TunnelJobResponseSerializer
from .types import TunnelCalculationResult, TunnelJobCreatePayload


@extend_schema(tags=["Tunnel"])
class TunnelJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints HTTP de Tunnel. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = TunnelJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV tabular de entradas y salidas del cálculo Tunnel."""
        result_payload: TunnelCalculationResult = cast(
            TunnelCalculationResult, job.results
        )
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

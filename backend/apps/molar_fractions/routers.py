"""routers.py: Endpoints HTTP dedicados para molar_fractions.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define solo:
1. create() con validación propia de molar_fractions.
2. build_csv_content() con formato CSV tabular (pH × especies).
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
from apps.core.reporting import escape_csv_cell
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import (
    MolarFractionsJobCreateSerializer,
    MolarFractionsJobResponseSerializer,
)
from .types import MolarFractionsJobCreatePayload, MolarFractionsResult


@extend_schema(tags=["MolarFractions"])
class MolarFractionsJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints HTTP de molar_fractions. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = MolarFractionsJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
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
                ",".join(escape_csv_cell(cell_value) for cell_value in row_cells)
            )

        return "\n".join(csv_lines)

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

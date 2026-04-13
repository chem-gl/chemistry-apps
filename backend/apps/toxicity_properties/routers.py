"""routers.py: Endpoints HTTP para Toxicity Properties Table.

Expone create/retrieve/reportes para jobs toxicológicos ejecutados con
ADMET-AI en segundo plano, reutilizando endpoints comunes del mixin core.
"""

from __future__ import annotations

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

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .schemas import ToxicityJobCreateSerializer, ToxicityJobResponseSerializer
from .types import ToxicityJobResult, ToxicityMoleculeResult


def _build_toxicity_csv(molecules: list[ToxicityMoleculeResult]) -> str:
    """Construye CSV con columnas fijas de propiedades toxicológicas."""
    header_line: str = (
        "name,smiles,LD50_mgkg,mutagenicity,ames_score,DevTox,devtox_score"
    )

    data_lines: list[str] = []
    for molecule in molecules:
        row_values: list[str] = [
            escape_csv_cell(molecule["name"]),
            escape_csv_cell(molecule["smiles"]),
            "" if molecule["LD50_mgkg"] is None else f"{molecule['LD50_mgkg']:.6f}",
            "" if molecule["mutagenicity"] is None else molecule["mutagenicity"],
            "" if molecule["ames_score"] is None else f"{molecule['ames_score']:.6f}",
            "" if molecule["DevTox"] is None else molecule["DevTox"],
            (
                ""
                if molecule["devtox_score"] is None
                else f"{molecule['devtox_score']:.6f}"
            ),
        ]
        data_lines.append(",".join([escape_csv_cell(value) for value in row_values]))

    return "\n".join([header_line, *data_lines])


@extend_schema(tags=["ToxicityProperties"])
class ToxicityPropertiesJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints de Toxicity Properties con ejecución asíncrona por job."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = ToxicityJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Entrega el reporte CSV del job toxicológico."""
        result_payload: ToxicityJobResult = cast(ToxicityJobResult, job.results)
        molecules: list[ToxicityMoleculeResult] = cast(
            list[ToxicityMoleculeResult],
            result_payload["molecules"],
        )
        return _build_toxicity_csv(molecules)

    @extend_schema(
        summary="Crear Job de Toxicity Properties",
        description=(
            "Crea un job asíncrono para predecir LD50, mutagenicidad (Ames) "
            "y toxicidad del desarrollo con ADMET-AI para una lista de SMILES."
        ),
        request=ToxicityJobCreateSerializer,
        responses={
            201: ToxicityJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato toxicológico.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible crear o encolar el job toxicológico.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea y encola un job toxicológico en el motor asíncrono."""
        serializer = ToxicityJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data: dict[str, object] = cast(
            dict[str, object], serializer.validated_data
        )
        parameters_payload: JSONMap = {
            "molecules": validated_data["molecules"],
        }
        version_value: str = str(
            validated_data.get("version", DEFAULT_ALGORITHM_VERSION)
        )

        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
        owner_id, group_id = self.resolve_actor_job_scope(request)
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=version_value,
            parameters=parameters_payload,
            owner_id=owner_id,
            group_id=group_id,
        ).run()

        if submit_result.is_failure():
            error_message: str = submit_result.fold(
                on_failure=lambda error_value: str(error_value),
                on_success=lambda _: "Error desconocido al crear el job toxicológico.",
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
            ScientificJob, pk=job_handle.job_id, plugin_name=PLUGIN_NAME
        )
        response_serializer = ToxicityJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

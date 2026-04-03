"""routers.py: Endpoints HTTP dedicados para la app Marcus.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error, report-inputs) y define adicionalmente:
1. create() multipart con persistencia de artefactos.
2. build_csv_content() con formato CSV de resultados Marcus.
"""

from __future__ import annotations

from typing import cast

from django.core.files.uploadedfile import UploadedFile
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.artifacts import build_file_descriptor
from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import MarcusJobCreateSerializer, MarcusJobResponseSerializer


@extend_schema(tags=["Marcus"])
class MarcusJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints de Marcus. Hereda retrieve y reportes del mixin."""

    parser_classes = [MultiPartParser, FormParser]
    plugin_name = PLUGIN_NAME
    response_serializer_class = MarcusJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV de resultados principales del cálculo Marcus."""
        parameters_payload: JSONMap = cast(JSONMap, job.parameters)
        result_payload: JSONMap = cast(JSONMap, job.results)

        csv_lines: list[str] = [
            (
                "title,diffusion,temperature_k,adiabatic_energy_kcal_mol,"
                "adiabatic_energy_corrected_kcal_mol,vertical_energy_kcal_mol,"
                "reorganization_energy_kcal_mol,barrier_kcal_mol,rate_constant_tst,"
                "rate_constant"
            ),
            (
                f"{str(parameters_payload['title'])},"
                f"{str(parameters_payload['diffusion'])},"
                f"{float(result_payload['temperature_k']):.8f},"
                f"{float(result_payload['adiabatic_energy_kcal_mol']):.8f},"
                f"{float(result_payload['adiabatic_energy_corrected_kcal_mol']):.8f},"
                f"{float(result_payload['vertical_energy_kcal_mol']):.8f},"
                f"{float(result_payload['reorganization_energy_kcal_mol']):.8f},"
                f"{float(result_payload['barrier_kcal_mol']):.8f},"
                f"{float(result_payload['rate_constant_tst']):.8e},"
                f"{float(result_payload['rate_constant']):.8e}"
            ),
        ]

        return "\n".join(csv_lines)

    @extend_schema(
        summary="Crear Job Marcus",
        description=(
            "Crea un job asíncrono Marcus con seis archivos Gaussian en multipart "
            "y parámetros opcionales de difusión."
        ),
        request=MarcusJobCreateSerializer,
        responses={
            201: MarcusJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación en create multipart Marcus.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible crear o encolar el job Marcus.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job Marcus, persiste artefactos y encola ejecución."""
        serializer = MarcusJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data: dict[str, object] = cast(
            dict[str, object], serializer.validated_data
        )

        file_field_names: list[str] = [
            "reactant_1_file",
            "reactant_2_file",
            "product_1_adiabatic_file",
            "product_2_adiabatic_file",
            "product_1_vertical_file",
            "product_2_vertical_file",
        ]
        uploaded_files: list[tuple[str, UploadedFile]] = [
            (field_name, cast(UploadedFile, validated_data[field_name]))
            for field_name in file_field_names
        ]

        file_descriptors: list[dict[str, str | int]] = [
            build_file_descriptor(field_name, uploaded_file)
            for field_name, uploaded_file in uploaded_files
        ]

        parameters_payload: JSONMap = {
            "title": str(validated_data["title"]),
            "diffusion": bool(validated_data["diffusion"]),
            "radius_reactant_1": (
                float(validated_data["radius_reactant_1"])
                if validated_data.get("radius_reactant_1") is not None
                else None
            ),
            "radius_reactant_2": (
                float(validated_data["radius_reactant_2"])
                if validated_data.get("radius_reactant_2") is not None
                else None
            ),
            "reaction_distance": (
                float(validated_data["reaction_distance"])
                if validated_data.get("reaction_distance") is not None
                else None
            ),
            "file_descriptors": cast(JSONMap, {"items": file_descriptors})["items"],
        }

        version_value: str = str(validated_data["version"])
        # Delegar creación, persistencia de artefactos y despacho al helper del mixin
        return self.prepare_and_dispatch_with_artifacts(
            parameters_payload=parameters_payload,
            version_value=version_value,
            uploaded_files=uploaded_files,
        )

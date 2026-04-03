"""routers.py: Endpoints HTTP dedicados para la app Easy-rate.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error, report-inputs) y define adicionalmente:
1. create() multipart con persistencia de artefactos.
2. build_csv_content() con formato CSV de entradas/salidas Easy-rate.
3. inspect_input() para parseo previo de archivos Gaussian.
"""

from __future__ import annotations

from typing import cast

from django.core.files.uploadedfile import UploadedFile
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.artifacts import build_file_descriptor, normalize_chunk_to_bytes
from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import (
    EasyRateInspectionRequestSerializer,
    EasyRateInspectionResponseSerializer,
    EasyRateJobCreateSerializer,
    EasyRateJobResponseSerializer,
)


def _collect_uploaded_files(
    validated_data: dict[str, object],
) -> list[tuple[str, UploadedFile]]:
    """Recupera únicamente archivos presentes en el payload validado."""
    file_field_names: list[str] = [
        "reactant_1_file",
        "reactant_2_file",
        "transition_state_file",
        "product_1_file",
        "product_2_file",
    ]

    uploaded_files: list[tuple[str, UploadedFile]] = []
    for field_name in file_field_names:
        raw_file = validated_data.get(field_name)
        if raw_file is None:
            continue
        uploaded_files.append((field_name, cast(UploadedFile, raw_file)))

    return uploaded_files


@extend_schema(tags=["EasyRate"])
class EasyRateJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints de Easy-rate. Hereda retrieve y reportes del mixin."""

    parser_classes = [MultiPartParser, FormParser]
    plugin_name = PLUGIN_NAME
    response_serializer_class = EasyRateJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV compacto de entradas y salidas principales de Easy-rate."""
        result_payload: JSONMap = cast(JSONMap, job.results)
        parameters_payload: JSONMap = cast(JSONMap, job.parameters)

        csv_lines: list[str] = [
            (
                "title,reaction_path_degeneracy,cage_effects,diffusion,solvent,"
                "gibbs_reaction_kcal_mol,gibbs_activation_kcal_mol,rate_constant,"
                "rate_constant_tst,kappa_tst,temperature_k,imaginary_frequency_cm1"
            ),
            (
                f"{str(parameters_payload['title'])},"
                f"{float(parameters_payload['reaction_path_degeneracy']):.8f},"
                f"{str(parameters_payload['cage_effects'])},"
                f"{str(parameters_payload['diffusion'])},"
                f"{str(parameters_payload['solvent'])},"
                f"{float(result_payload['gibbs_reaction_kcal_mol']):.8f},"
                f"{float(result_payload['gibbs_activation_kcal_mol']):.8f},"
                f"{str(result_payload['rate_constant'])},"
                f"{str(result_payload['rate_constant_tst'])},"
                f"{float(result_payload['kappa_tst']):.8f},"
                f"{float(result_payload['temperature_k']):.8f},"
                f"{float(result_payload['imaginary_frequency_cm1']):.8f}"
            ),
        ]

        return "\n".join(csv_lines)

    @extend_schema(
        summary="Inspeccionar archivo Gaussian para Easy-rate",
        description=(
            "Parsea un archivo Gaussian sin crear job y devuelve las ejecuciones "
            "candidatas para selección previa en frontend."
        ),
        request=EasyRateInspectionRequestSerializer,
        responses={
            200: EasyRateInspectionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible inspeccionar el archivo cargado.",
            ),
        },
    )
    @action(detail=False, methods=["post"], url_path="inspect-input")
    def inspect_input(self, request: Request) -> Response:
        """Inspecciona un archivo Gaussian antes de crear un job Easy-rate."""
        serializer = EasyRateInspectionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            from ._gaussian_inspector import inspect_easy_rate_gaussian_blob
        except ModuleNotFoundError:
            return Response(
                {
                    "detail": (
                        "Easy-rate no está disponible porque falta dependencia "
                        "local 'libs' en este entorno."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        validated_data: dict[str, object] = cast(
            dict[str, object], serializer.validated_data
        )
        uploaded_file = cast(UploadedFile, validated_data["gaussian_file"])
        source_field = str(validated_data["source_field"])

        file_chunks: list[bytes] = []
        for chunk in uploaded_file.chunks():
            file_chunks.append(normalize_chunk_to_bytes(chunk))
        uploaded_file.seek(0)

        inspection_payload = inspect_easy_rate_gaussian_blob(
            source_field=source_field,
            original_filename=str(uploaded_file.name),
            artifact_bytes=b"".join(file_chunks),
        )
        response_serializer = EasyRateInspectionResponseSerializer(inspection_payload)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Crear Job Easy-rate",
        description=(
            "Crea un job asíncrono Easy-rate a partir de archivos Gaussian "
            "cargados en multipart y parámetros de ejecución."
        ),
        request=EasyRateJobCreateSerializer,
        responses={
            201: EasyRateJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación en create multipart.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible crear o encolar el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job Easy-rate, persiste archivos en DB y luego encola ejecución."""
        serializer = EasyRateJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data: dict[str, object] = cast(
            dict[str, object], serializer.validated_data
        )
        uploaded_files: list[tuple[str, UploadedFile]] = _collect_uploaded_files(
            validated_data
        )
        file_descriptors: list[dict[str, str | int]] = [
            build_file_descriptor(field_name, uploaded_file)
            for field_name, uploaded_file in uploaded_files
        ]

        parameters_payload: JSONMap = {
            "title": str(validated_data["title"]),
            "reaction_path_degeneracy": float(
                validated_data["reaction_path_degeneracy"]
            ),
            "cage_effects": bool(validated_data["cage_effects"]),
            "diffusion": bool(validated_data["diffusion"]),
            "solvent": str(validated_data["solvent"]),
            "custom_viscosity": (
                float(validated_data["custom_viscosity"])
                if validated_data.get("custom_viscosity") is not None
                else None
            ),
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
            "print_data_input": bool(validated_data["print_data_input"]),
            "reactant_1_execution_index": (
                int(validated_data["reactant_1_execution_index"])
                if validated_data.get("reactant_1_execution_index") is not None
                else None
            ),
            "reactant_2_execution_index": (
                int(validated_data["reactant_2_execution_index"])
                if validated_data.get("reactant_2_execution_index") is not None
                else None
            ),
            "transition_state_execution_index": (
                int(validated_data["transition_state_execution_index"])
                if validated_data.get("transition_state_execution_index") is not None
                else None
            ),
            "product_1_execution_index": (
                int(validated_data["product_1_execution_index"])
                if validated_data.get("product_1_execution_index") is not None
                else None
            ),
            "product_2_execution_index": (
                int(validated_data["product_2_execution_index"])
                if validated_data.get("product_2_execution_index") is not None
                else None
            ),
            "file_descriptors": cast(JSONMap, {"items": file_descriptors})["items"],
        }

        version_value: str = str(validated_data["version"])

        # Crear job sin encolar (flujo en dos pasos: crear → artefactos → despachar)
        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
        prepare_result = declarative_api.prepare_job(
            plugin=PLUGIN_NAME,
            version=version_value,
            parameters=parameters_payload,
        ).run()

        if prepare_result.is_failure():
            return Response(
                {"detail": "No fue posible crear el job."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        job_handle = prepare_result.get_or_else(None)
        created_job: ScientificJob = get_object_or_404(
            ScientificJob, pk=job_handle.job_id
        )

        # Delegar persistencia de artefactos y despacho al helper del mixin
        artifact_error = self.persist_artifacts_and_dispatch(
            created_job=created_job,
            uploaded_files=uploaded_files,
            job_handle=job_handle,
        )
        if artifact_error is not None:
            return artifact_error

        created_job.refresh_from_db()
        response_serializer = EasyRateJobResponseSerializer(created_job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

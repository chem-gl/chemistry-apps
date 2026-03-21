"""routers.py: Endpoints HTTP dedicados para la app Marcus.

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define adicionalmente:
1. create() multipart con persistencia de artefactos.
2. build_csv_content() con formato CSV de resultados Marcus.
3. report_inputs() para descarga ZIP de entradas persistidas.
"""

from __future__ import annotations

from typing import cast

from django.core.files.uploadedfile import UploadedFile
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.artifacts import (
    ScientificInputArtifactStorageService,
    build_file_descriptor,
)
from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.reporting import build_download_filename
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
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

        artifact_storage_service = ScientificInputArtifactStorageService()
        try:
            for field_name, uploaded_file in uploaded_files:
                artifact_storage_service.store_uploaded_file(
                    job=created_job,
                    uploaded_file=uploaded_file,
                    field_name=field_name,
                    role="input",
                )
        except Exception as error_value:
            created_job.status = "failed"
            created_job.error_trace = str(error_value)
            created_job.progress_percentage = 100
            created_job.progress_stage = "failed"
            created_job.progress_message = "Error al persistir archivos de entrada."
            created_job.save(
                update_fields=[
                    "status",
                    "error_trace",
                    "progress_percentage",
                    "progress_stage",
                    "progress_message",
                    "updated_at",
                ]
            )
            return Response(
                {"detail": "No fue posible persistir los archivos de entrada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Despachar al broker ahora que los artefactos están persistidos
        job_handle.dispatch_if_pending().run()

        created_job.refresh_from_db()
        response_serializer = MarcusJobResponseSerializer(created_job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Descargar Entradas Originales de Marcus",
        description=(
            "Descarga ZIP con artefactos de entrada persistidos y manifest.json "
            "para reproducibilidad/reintento."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo ZIP con entradas persistidas del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job Marcus no encontrado.",
            ),
            409: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No existen artefactos de entrada persistidos.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-inputs")
    def report_inputs(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega ZIP de artefactos de entrada asociados al job Marcus."""
        job: ScientificJob = self.get_job_or_404(id)

        artifact_storage_service = ScientificInputArtifactStorageService()
        if len(artifact_storage_service.list_job_artifacts(job=job)) == 0:
            return Response(
                {"detail": "El job no tiene artefactos de entrada persistidos."},
                status=status.HTTP_409_CONFLICT,
            )

        zip_bytes: bytes = artifact_storage_service.build_job_artifacts_zip_bytes(
            job=job
        )
        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="inputs",
            extension="zip",
        )

        response = HttpResponse(zip_bytes, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

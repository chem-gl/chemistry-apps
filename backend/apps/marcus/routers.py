"""routers.py: Endpoints HTTP dedicados para la app Marcus.

Objetivo del archivo:
- Exponer create multipart, consulta y reportes para cinética Marcus.
"""

from __future__ import annotations

import hashlib
from typing import cast

from apps.core.artifacts import ScientificInputArtifactStorageService
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
from django.core.files.uploadedfile import UploadedFile
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
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from .definitions import PLUGIN_NAME
from .schemas import MarcusJobCreateSerializer, MarcusJobResponseSerializer


def _normalize_chunk_to_bytes(chunk: bytes | memoryview | str) -> bytes:
    """Normaliza chunk multipart en bytes para hashing."""
    if isinstance(chunk, bytes):
        return chunk
    if isinstance(chunk, memoryview):
        return chunk.tobytes()
    return chunk.encode("utf-8")


def _build_file_descriptor(
    field_name: str, uploaded_file: UploadedFile
) -> dict[str, str | int]:
    """Calcula descriptor estable de archivo cargado."""
    hasher = hashlib.sha256()
    total_size_bytes: int = 0

    for chunk in uploaded_file.chunks():
        chunk_bytes = _normalize_chunk_to_bytes(chunk)
        hasher.update(chunk_bytes)
        total_size_bytes += len(chunk_bytes)

    uploaded_file.seek(0)

    return {
        "field_name": field_name,
        "original_filename": str(uploaded_file.name),
        "content_type": (
            str(uploaded_file.content_type)
            if uploaded_file.content_type is not None
            else "application/octet-stream"
        ),
        "sha256": hasher.hexdigest(),
        "size_bytes": total_size_bytes,
    }


def _build_marcus_csv(job: ScientificJob) -> str:
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


@extend_schema(tags=["Marcus"])
class MarcusJobViewSet(viewsets.ViewSet):
    """Expone endpoints de Marcus con create multipart y reportes."""

    parser_classes = [MultiPartParser, FormParser]
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

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
            _build_file_descriptor(field_name, uploaded_file)
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
        summary="Consultar Job Marcus",
        description="Devuelve estado, progreso y resultados del job por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job Marcus.",
            )
        ],
        responses={
            200: MarcusJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job Marcus no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera job Marcus filtrando por plugin."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = MarcusJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV de Marcus",
        description="Descarga CSV de resultados principales para jobs completed.",
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV generado a partir del job Marcus.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job Marcus no encontrado.",
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
        """Entrega CSV de resultados para jobs Marcus completados."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error},
                status=status.HTTP_409_CONFLICT,
            )

        csv_content = _build_marcus_csv(job)
        filename = build_download_filename(
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
        summary="Descargar Reporte LOG de Marcus",
        description="Descarga log técnico de parámetros, resultados y eventos.",
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con trazabilidad completa del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job Marcus no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual consolidado del job Marcus."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_marcus_csv(job)

        report_content = build_job_log_report(job=job, csv_content=csv_content)
        filename = build_download_filename(
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
        summary="Descargar Reporte de Error de Marcus",
        description="Descarga reporte de error para jobs failed con traza persistida.",
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo de texto con detalle del fallo del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job Marcus no encontrado.",
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
        """Entrega reporte de error para jobs Marcus fallidos."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        error_report = build_job_error_report(job)
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

        filename = build_download_filename(
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
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        artifact_storage_service = ScientificInputArtifactStorageService()
        if len(artifact_storage_service.list_job_artifacts(job=job)) == 0:
            return Response(
                {"detail": "El job no tiene artefactos de entrada persistidos."},
                status=status.HTTP_409_CONFLICT,
            )

        zip_bytes = artifact_storage_service.build_job_artifacts_zip_bytes(job=job)
        filename = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="inputs",
            extension="zip",
        )

        response = HttpResponse(zip_bytes, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

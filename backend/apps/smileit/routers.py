"""routers.py: Endpoints de la app smileit sobre el núcleo de jobs.

Objetivo del archivo:
- Exponer endpoints de creación/consulta del job de generación de sustituyentes
  y endpoints auxiliares sin trazabilidad para la experiencia interactiva del frontend.

Cómo se usa:
1. Endpoints de job: create, retrieve, report-csv, report-log, report-error.
2. Endpoints auxiliares (sin job): inspect-structure, catalog.
   - inspect-structure: valida un SMILES y devuelve átomos indexados + SVG.
   - catalog: lista los sustituyentes del catálogo inicial.
"""

import logging
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

from .catalog import get_initial_catalog
from .definitions import PLUGIN_NAME
from .engine import inspect_smiles_structure
from .schemas import (
    SmileitCatalogEntrySerializer,
    SmileitJobCreateSerializer,
    SmileitJobResponseSerializer,
    SmileitStructureInspectionRequestSerializer,
    SmileitStructureInspectionResponseSerializer,
)
from .types import SmileitJobCreatePayload, SmileitResult

logger = logging.getLogger(__name__)


def _escape_csv_cell(raw_value: str) -> str:
    """Escapa una celda CSV para mantener formato válido al descargar."""
    escaped_value: str = raw_value.replace('"', '""')
    if any(separator in escaped_value for separator in [",", "\n", "\r", '"']):
        return f'"{escaped_value}"'
    return escaped_value


def _build_smileit_csv(job: ScientificJob) -> str:
    """Construye CSV con índice, nombre y SMILES de cada estructura generada."""
    results_payload: SmileitResult = cast(SmileitResult, job.results)
    structures = results_payload.get("generated_structures", [])

    csv_lines: list[str] = ["index,name,smiles"]
    for index_value, structure in enumerate(structures, start=1):
        csv_lines.append(
            ",".join(
                [
                    _escape_csv_cell(str(index_value)),
                    _escape_csv_cell(structure.get("name", "")),
                    _escape_csv_cell(structure.get("smiles", "")),
                ]
            )
        )

    # Cabecera de resumen
    summary_lines: list[str] = [
        f"# Smileit - Job: {job.id}",
        f"# Principal: {results_payload.get('principal_smiles', '')}",
        f"# Total generadas: {results_payload.get('total_generated', 0)}",
        f"# Truncado: {results_payload.get('truncated', False)}",
        "",
    ]
    return "\n".join(summary_lines + csv_lines)


@extend_schema(tags=["Smileit"])
class SmileitJobViewSet(viewsets.ViewSet):
    """Expone endpoints dedicados para generación combinatoria de sustituyentes SMILES."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    # --------------------------------------------------------------------------
    # Endpoints auxiliares sin trazabilidad de job
    # --------------------------------------------------------------------------

    @extend_schema(
        summary="Inspeccionar Estructura SMILES",
        description=(
            "Valida un SMILES y retorna la lista de átomos indexados junto con un SVG "
            "de la molécula renderizada. Se usa para que el frontend permita selección "
            "interactiva de átomos de sustitución antes de crear el job."
        ),
        request=SmileitStructureInspectionRequestSerializer,
        responses={
            200: SmileitStructureInspectionResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="SMILES inválido o no parseable.",
            ),
        },
    )
    @action(detail=False, methods=["post"], url_path="inspect-structure")
    def inspect_structure(self, request: Request) -> Response:
        """Inspecciona un SMILES y devuelve átomos indexados para la UI de selección."""
        request_serializer = SmileitStructureInspectionRequestSerializer(
            data=request.data
        )
        request_serializer.is_valid(raise_exception=True)
        smiles_input: str = request_serializer.validated_data["smiles"]

        try:
            inspection_result = inspect_smiles_structure(smiles_input)
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response_serializer = SmileitStructureInspectionResponseSerializer(
            inspection_result
        )
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Obtener Catálogo de Sustituyentes",
        description=(
            "Retorna la lista de sustituyentes del catálogo inicial migrado desde "
            "el legado Java Smile-it. Útil para el selector de sustituyentes del frontend."
        ),
        responses={
            200: SmileitCatalogEntrySerializer(many=True),
        },
    )
    @action(detail=False, methods=["get"], url_path="catalog")
    def catalog(self, request: Request) -> Response:
        """Retorna el catálogo inicial de sustituyentes."""
        catalog_entries = get_initial_catalog()
        serializer = SmileitCatalogEntrySerializer(catalog_entries, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # --------------------------------------------------------------------------
    # Endpoints de job con trazabilidad
    # --------------------------------------------------------------------------

    @extend_schema(
        summary="Crear Job Smileit",
        description=(
            "Crea un job asíncrono que genera moléculas por sustitución combinatoria "
            "sobre la molécula principal en los átomos seleccionados."
        ),
        request=SmileitJobCreateSerializer,
        responses={
            201: SmileitJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato smileit.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea y despacha un job smileit preservando trazabilidad de progreso."""
        serializer = SmileitJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: SmileitJobCreatePayload = cast(
            SmileitJobCreatePayload,
            serializer.validated_data,
        )

        version_value: str = validated_payload["version"]
        parameters_payload: JSONMap = {
            "principal_smiles": validated_payload["principal_smiles"],
            "selected_atom_indices": validated_payload["selected_atom_indices"],
            "substituents": validated_payload["substituents"],
            "r_substitutes": validated_payload["r_substitutes"],
            "num_bonds": validated_payload["num_bonds"],
            "allow_repeated": validated_payload["allow_repeated"],
            "max_structures": validated_payload["max_structures"],
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

        response_serializer = SmileitJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job Smileit",
        description="Devuelve estado y resultado del job smileit por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job smileit.",
            )
        ],
        responses={
            200: SmileitJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job smileit no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera un job smileit filtrando por plugin dedicado."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = SmileitJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV de Smileit",
        description=(
            "Descarga un CSV con índice, nombre y SMILES de cada estructura generada. "
            "Solo aplica para jobs en estado completed."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV construido desde resultados del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job smileit no encontrado.",
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
        """Entrega CSV de estructuras generadas para jobs completed de smileit."""
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

        csv_content: str = _build_smileit_csv(job)
        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="structures",
            extension="csv",
        )
        return build_text_download_response(
            content=csv_content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Reporte LOG de Smileit",
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
                description="Job smileit no encontrado.",
            ),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual unificado para auditoría de ejecución smileit."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_smileit_csv(job)

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
        summary="Descargar Reporte de Error de Smileit",
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
                description="Job smileit no encontrado.",
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
        """Entrega reporte de error para jobs fallidos de smileit."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )

        error_content: str | None = build_job_error_report(job)
        if error_content is None:
            return Response(
                {"detail": "El job no tiene un error exportable o no ha fallado."},
                status=status.HTTP_409_CONFLICT,
            )

        filename: str = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="error",
            extension="log",
        )
        return build_text_download_response(
            content=error_content,
            filename=filename,
            content_type="text/plain; charset=utf-8",
        )

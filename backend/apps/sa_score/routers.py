"""routers.py: Endpoints HTTP para la app SA Score.

Hereda de ScientificAppViewSetMixin los endpoints comunes:
  - retrieve() → GET /{id}/
  - report_csv() → GET /{id}/report-csv/     (CSV con todos los métodos solicitados)
  - report_log() → GET /{id}/report-log/
  - report_error() → GET /{id}/report-error/

Agrega:
  - create() → POST /                           (crea y encola job)
  - report_csv_by_method() → GET /{id}/report-csv-method/?method=ambit|brsa|rdkit
    (CSV con columnas smiles,sa para un método específico)
"""

from __future__ import annotations

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

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.reporting import (
    build_download_filename,
    build_text_download_response,
    escape_csv_cell,
    validate_job_for_csv_report,
)
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME, SA_SCORE_METHODS
from .schemas import SaScoreJobCreateSerializer, SaScoreJobResponseSerializer
from .types import SaMoleculeResult, SaScoreJobResult


def _build_full_csv(molecules: list[SaMoleculeResult], methods: list[str]) -> str:
    """Construye CSV con una columna por método solicitado más la columna smiles.

    Nota de unidades:
    - `ambit_sa_percent`: AMBIT expone accesibilidad como porcentaje (0-100).
    - `brsa_sa` y `rdkit_sa`: escala SA clásica 1-10.
    """
    # Mapeo dinámico de métodos a campos de resultado
    method_field_map: dict[str, str] = {
        "ambit": "ambit_sa",
        "brsa": "brsa_sa",
        "rdkit": "rdkit_sa",
    }

    # Solo incluir columnas de los métodos que se calcularon
    active_methods: list[str] = [m for m in SA_SCORE_METHODS if m in methods]
    method_header_map: dict[str, str] = {
        "ambit": "ambit_sa_percent",
        "brsa": "brsa_sa",
        "rdkit": "rdkit_sa",
    }
    column_names: list[str] = ["smiles"] + [
        method_header_map[m] for m in active_methods
    ]
    header_line: str = ",".join(column_names)

    data_lines: list[str] = []
    for molecule in molecules:
        row_values: list[str] = [escape_csv_cell(molecule["smiles"])]
        for method_key in active_methods:
            field_name: str = method_field_map[method_key]
            score_value: float | None = cast(float | None, molecule.get(field_name))
            row_values.append("" if score_value is None else f"{score_value:.6f}")
        data_lines.append(",".join(row_values))

    return "\n".join([header_line, *data_lines])


def _build_single_method_csv(molecules: list[SaMoleculeResult], method: str) -> str:
    """Construye CSV para un método específico con encabezado según su unidad."""
    method_field_map: dict[str, str] = {
        "ambit": "ambit_sa",
        "brsa": "brsa_sa",
        "rdkit": "rdkit_sa",
    }
    field_name: str = method_field_map[method]
    header_line: str = "smiles,sa_percent" if method == "ambit" else "smiles,sa"

    data_lines: list[str] = []
    for molecule in molecules:
        score_value: float | None = cast(float | None, molecule.get(field_name))
        sa_cell: str = "" if score_value is None else f"{score_value:.6f}"
        row: str = f"{escape_csv_cell(molecule['smiles'])},{sa_cell}"
        data_lines.append(row)

    return "\n".join([header_line, *data_lines])


@extend_schema(tags=["SAScore"])
class SaScoreJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints de SA Score. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = SaScoreJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV con todos los métodos solicitados (columna por método)."""
        result_payload: SaScoreJobResult = cast(SaScoreJobResult, job.results)
        molecules: list[SaMoleculeResult] = cast(
            list[SaMoleculeResult], result_payload["molecules"]
        )
        requested_methods: list[str] = cast(
            list[str], result_payload["requested_methods"]
        )
        return _build_full_csv(molecules, requested_methods)

    @extend_schema(
        summary="Crear Job de SA Score",
        description=(
            "Crea un job asíncrono que calcula accesibilidad sintética para una "
            "lista de SMILES usando los métodos seleccionados (ambit, brsa, rdkit)."
        ),
        request=SaScoreJobCreateSerializer,
        responses={
            201: SaScoreJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato SA score.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job de SA score y encola la ejecución asíncrona."""
        serializer = SaScoreJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data: dict[str, object] = cast(
            dict[str, object], serializer.validated_data
        )
        parameters_payload: JSONMap = {
            "smiles_list": validated_data["smiles"],
            "methods": validated_data["methods"],
        }
        version_value: str = str(
            validated_data.get("version", DEFAULT_ALGORITHM_VERSION)
        )

        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
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
            ScientificJob, pk=job_handle.job_id, plugin_name=PLUGIN_NAME
        )
        response_serializer = SaScoreJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Descargar CSV por método específico",
        description=(
            "Descarga CSV por método específico. Para AMBIT la columna es "
            "smiles,sa_percent (escala 0-100). Para BRSA/RDKit la columna es "
            "smiles,sa (escala SA clásica 1-10). Solo aplica para jobs completed."
        ),
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job.",
            ),
            OpenApiParameter(
                name="method",
                type=str,
                location=OpenApiParameter.QUERY,
                description="Método SA score: ambit, brsa o rdkit.",
                required=True,
                enum=list(SA_SCORE_METHODS),
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description=(
                    "Archivo CSV. AMBIT: smiles,sa_percent (0-100). "
                    "BRSA/RDKit: smiles,sa (1-10)."
                ),
            ),
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Método no válido o no fue calculado en este job.",
            ),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-csv-method")
    def report_csv_by_method(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega CSV de un solo método (smiles,sa) cuando el job terminó."""
        job: ScientificJob = self.get_job_or_404(id)

        validation_error: str | None = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error},
                status=status.HTTP_409_CONFLICT,
            )

        requested_method: str = request.query_params.get("method", "")
        if requested_method not in SA_SCORE_METHODS:
            return Response(
                {
                    "detail": (
                        f"Método '{requested_method}' no válido. "
                        f"Opciones: {', '.join(SA_SCORE_METHODS)}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        result_payload: SaScoreJobResult = cast(SaScoreJobResult, job.results)
        requested_methods_in_job: list[str] = cast(
            list[str], result_payload["requested_methods"]
        )
        if requested_method not in requested_methods_in_job:
            return Response(
                {
                    "detail": (
                        f"El método '{requested_method}' no fue calculado en este job. "
                        f"Métodos disponibles: {', '.join(requested_methods_in_job)}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        molecules: list[SaMoleculeResult] = cast(
            list[SaMoleculeResult], result_payload["molecules"]
        )
        csv_content: str = _build_single_method_csv(molecules, requested_method)
        filename: str = build_download_filename(
            plugin_name=self.plugin_name,
            job_id=str(job.id),
            report_suffix=f"{requested_method}_sa",
            extension="csv",
        )
        return build_text_download_response(
            content=csv_content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

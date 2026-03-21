"""routers.py: Endpoints HTTP profesionales para Smile-it.

Objetivo del archivo:
- Exponer CRUD de catálogos/patrones y endpoints de jobs con asignación flexible
  por bloques, trazabilidad completa y exportes reproducibles.

Cómo se usa:
- Frontend consume estos endpoints para inspección, configuración y ejecución.
- El core de jobs mantiene estado/progreso/logs y este router delega ejecución.
"""

from __future__ import annotations

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

from .catalog import (
    create_catalog_substituent,
    create_pattern_entry,
    list_active_catalog_entries,
    list_active_categories,
    list_active_patterns,
    normalize_manual_substituent,
    resolve_catalog_substituent_reference,
    resolve_catalog_substituents_by_categories,
    update_catalog_substituent,
)
from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .engine import inspect_smiles_structure_with_patterns
from .schemas import (
    SmileitCatalogEntryCreateSerializer,
    SmileitCatalogEntrySerializer,
    SmileitCategorySerializer,
    SmileitJobCreateSerializer,
    SmileitJobResponseSerializer,
    SmileitPatternEntryCreateSerializer,
    SmileitPatternEntrySerializer,
    SmileitStructureInspectionRequestSerializer,
    SmileitStructureInspectionResponseSerializer,
)
from .types import (
    SmileitAssignmentBlockInput,
    SmileitCatalogEntry,
    SmileitJobCreatePayload,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
    SmileitResult,
    SmileitSubstituentCreatePayload,
)

logger = logging.getLogger(__name__)


def _escape_csv_cell(raw_value: str) -> str:
    """Escapa una celda CSV para exportación segura y reproducible."""
    escaped_value = raw_value.replace('"', '""')
    if any(separator in escaped_value for separator in [",", "\n", "\r", '"']):
        return f'"{escaped_value}"'
    return escaped_value


def _build_structures_csv(job: ScientificJob) -> str:
    """Construye CSV de estructuras generadas con nombre y SMILES."""
    results_payload = cast(SmileitResult, job.results)
    structures = results_payload.get("generated_structures", [])

    lines: list[str] = ["index,name,smiles,traceability_events"]
    for index_value, structure in enumerate(structures, start=1):
        traceability_size = len(structure.get("traceability", []))
        lines.append(
            ",".join(
                [
                    _escape_csv_cell(str(index_value)),
                    _escape_csv_cell(structure.get("name", "")),
                    _escape_csv_cell(structure.get("smiles", "")),
                    _escape_csv_cell(str(traceability_size)),
                ]
            )
        )

    return "\n".join(lines)


def _build_traceability_csv(job: ScientificJob) -> str:
    """Construye CSV de trazabilidad sitio -> sustituyente por derivado."""
    results_payload = cast(SmileitResult, job.results)
    rows = results_payload.get("traceability_rows", [])

    lines: list[str] = [
        "derivative_name,derivative_smiles,round_index,site_atom_index,"
        "block_label,block_priority,substituent_name,substituent_smiles,substituent_stable_id,"
        "substituent_version,source_kind,bond_order"
    ]

    for row in rows:
        lines.append(
            ",".join(
                [
                    _escape_csv_cell(str(row.get("derivative_name", ""))),
                    _escape_csv_cell(str(row.get("derivative_smiles", ""))),
                    _escape_csv_cell(str(row.get("round_index", ""))),
                    _escape_csv_cell(str(row.get("site_atom_index", ""))),
                    _escape_csv_cell(str(row.get("block_label", ""))),
                    _escape_csv_cell(str(row.get("block_priority", ""))),
                    _escape_csv_cell(str(row.get("substituent_name", ""))),
                    _escape_csv_cell(str(row.get("substituent_smiles", ""))),
                    _escape_csv_cell(str(row.get("substituent_stable_id", ""))),
                    _escape_csv_cell(str(row.get("substituent_version", ""))),
                    _escape_csv_cell(str(row.get("source_kind", ""))),
                    _escape_csv_cell(str(row.get("bond_order", ""))),
                ]
            )
        )

    return "\n".join(lines)


def _build_enumerated_smiles_export(job: ScientificJob) -> str:
    """Construye export principal NAME + NAME_XXXXX SMILES para DataWarrior."""
    results_payload = cast(SmileitResult, job.results)
    structures = results_payload.get("generated_structures", [])
    export_name_base = str(results_payload.get("export_name_base", "SMILEIT"))
    export_padding = int(results_payload.get("export_padding", 5))

    lines: list[str] = [export_name_base]
    for index_value, structure in enumerate(structures, start=1):
        derivative_name = f"{export_name_base}_{index_value:0{export_padding}d}"
        lines.append(f"{derivative_name} {structure.get('smiles', '')}")
    return "\n".join(lines)


def _expand_catalog_entry_to_resolved(
    entry: SmileitCatalogEntry,
    source_kind: str,
) -> list[SmileitResolvedSubstituent]:
    """Expande un catálogo con múltiples anclajes a sustituyentes ejecutables."""
    output: list[SmileitResolvedSubstituent] = []
    for anchor_index in entry["anchor_atom_indices"]:
        output.append(
            SmileitResolvedSubstituent(
                source_kind=cast("str", source_kind),
                stable_id=entry["stable_id"],
                version=entry["version"],
                name=entry["name"],
                smiles=entry["smiles"],
                selected_atom_index=int(anchor_index),
                categories=[str(value) for value in entry["categories"]],
            )
        )
    return output


def _dedupe_resolved_substituents(
    entries: list[SmileitResolvedSubstituent],
) -> list[SmileitResolvedSubstituent]:
    """Deduplica sustituyentes resueltos preservando orden estable."""
    output: list[SmileitResolvedSubstituent] = []
    seen: set[tuple[str, int, int, str]] = set()

    for entry in entries:
        dedupe_key = (
            entry["stable_id"],
            entry["version"],
            entry["selected_atom_index"],
            entry["source_kind"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        output.append(entry)

    return output


def _dedupe_reference_rows(
    rows: list[dict[str, str | int]],
    left_key: str,
    right_key: str,
) -> list[dict[str, str | int]]:
    """Deduplica referencias por dos llaves preservando orden de inserción."""
    output: list[dict[str, str | int]] = []
    seen_rows: set[tuple[str, int]] = set()

    for row in rows:
        left_value = str(row[left_key])
        right_value = int(row[right_key])
        dedupe_key = (left_value, right_value)
        if dedupe_key in seen_rows:
            continue
        seen_rows.add(dedupe_key)
        output.append({left_key: left_value, right_key: right_value})

    return output


def _resolve_block_substituents(
    block: SmileitAssignmentBlockInput,
    category_map: dict[str, dict[str, str | int]],
    category_references: list[dict[str, str | int]],
    catalog_references: list[dict[str, str | int]],
) -> list[SmileitResolvedSubstituent]:
    """Resuelve sustituyentes efectivos de un bloque individual."""
    block_entries: list[SmileitResolvedSubstituent] = []

    for category_key in block["category_keys"]:
        category_entry = category_map.get(category_key)
        if category_entry is None:
            raise ValueError(
                f"La categoría '{category_key}' no existe o no está activa."
            )
        category_references.append(
            {
                "key": str(category_entry["key"]),
                "version": int(category_entry["version"]),
            }
        )

    for entry in resolve_catalog_substituents_by_categories(block["category_keys"]):
        block_entries.extend(_expand_catalog_entry_to_resolved(entry, "catalog"))
        catalog_references.append(
            {
                "stable_id": entry["stable_id"],
                "version": entry["version"],
            }
        )

    for reference in block["substituent_refs"]:
        catalog_entry = resolve_catalog_substituent_reference(reference)
        block_entries.extend(
            _expand_catalog_entry_to_resolved(catalog_entry, "catalog")
        )
        catalog_references.append(
            {
                "stable_id": catalog_entry["stable_id"],
                "version": catalog_entry["version"],
            }
        )

    for manual_entry in block["manual_substituents"]:
        normalized_entry = normalize_manual_substituent(manual_entry)
        block_entries.extend(
            _expand_catalog_entry_to_resolved(normalized_entry, "manual")
        )

    return _dedupe_resolved_substituents(block_entries)


def _resolve_assignment_blocks(
    payload: SmileitJobCreatePayload,
) -> tuple[list[SmileitResolvedAssignmentBlock], dict[str, list[dict[str, str | int]]]]:
    """Resuelve bloques con sustituyentes efectivos y referencias versionadas."""
    categories_catalog = list_active_categories()
    category_map: dict[str, dict[str, str | int]] = {
        entry["key"]: {
            "key": entry["key"],
            "version": entry["version"],
        }
        for entry in categories_catalog
    }

    resolved_blocks: list[SmileitResolvedAssignmentBlock] = []
    category_references: list[dict[str, str | int]] = []
    catalog_references: list[dict[str, str | int]] = []

    for priority, block in enumerate(payload["assignment_blocks"], start=1):
        resolved_entries = _resolve_block_substituents(
            block=block,
            category_map=category_map,
            category_references=category_references,
            catalog_references=catalog_references,
        )
        if len(resolved_entries) == 0:
            raise ValueError(
                f"El bloque '{block['label']}' no resolvió sustituyentes efectivos."
            )

        resolved_blocks.append(
            SmileitResolvedAssignmentBlock(
                label=block["label"],
                priority=priority,
                site_atom_indices=block["site_atom_indices"],
                resolved_substituents=resolved_entries,
            )
        )

    pattern_references: list[dict[str, str | int]] = [
        {
            "stable_id": entry["stable_id"],
            "version": entry["version"],
            "pattern_type": entry["pattern_type"],
        }
        for entry in list_active_patterns()
    ]

    references = {
        "substituents": _dedupe_reference_rows(
            catalog_references, "stable_id", "version"
        ),
        "categories": _dedupe_reference_rows(category_references, "key", "version"),
        "patterns": pattern_references,
    }

    return resolved_blocks, references


def _validate_effective_coverage(
    selected_sites: list[int],
    resolved_blocks: list[SmileitResolvedAssignmentBlock],
) -> list[int]:
    """Verifica cobertura final de sitios usando unión de bloques por cada átomo."""
    selected_set = set(selected_sites)
    covered_sites: set[int] = set()

    for block in resolved_blocks:
        if len(block["resolved_substituents"]) == 0:
            continue
        for site_atom_index in block["site_atom_indices"]:
            if site_atom_index in selected_set:
                covered_sites.add(site_atom_index)

    return [
        site_atom_index
        for site_atom_index in selected_sites
        if site_atom_index not in covered_sites
    ]


@extend_schema(tags=["Smileit"])
class SmileitJobViewSet(viewsets.ViewSet):
    """Endpoints de Smile-it para inspección, configuración y jobs ejecutables."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Listar Categorías Químicas de Smile-it",
        responses={200: SmileitCategorySerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="categories")
    def categories(self, request: Request) -> Response:
        """Lista categorías activas verificables para selección por bloque."""
        serializer = SmileitCategorySerializer(list_active_categories(), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Gestionar Catálogo de Sustituyentes",
        request=SmileitCatalogEntryCreateSerializer,
        responses={
            200: SmileitCatalogEntrySerializer(many=True),
            201: SmileitCatalogEntrySerializer,
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=False, methods=["get", "post"], url_path="catalog")
    def catalog(self, request: Request) -> Response:
        """Lista o crea sustituyentes persistidos activos de Smile-it."""
        if request.method.lower() == "get":
            serializer = SmileitCatalogEntrySerializer(
                list_active_catalog_entries(), many=True
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = SmileitCatalogEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            created_entry = create_catalog_substituent(serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        response_serializer = SmileitCatalogEntrySerializer(created_entry)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Actualizar Catálogo de Sustituyentes de Usuario",
        parameters=[
            OpenApiParameter(
                name="stable_id",
                type=str,
                location=OpenApiParameter.PATH,
                description=(
                    "Stable ID del catálogo a versionar; solo entradas de usuario son editables."
                ),
            )
        ],
        request=SmileitCatalogEntryCreateSerializer,
        responses={
            200: SmileitCatalogEntrySerializer(many=True),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["patch"],
        url_path=r"catalog/(?P<stable_id>[^/.]+)",
    )
    def update_catalog(
        self, request: Request, stable_id: str | None = None
    ) -> Response:
        """Versiona una entrada de catálogo editable y retorna el catálogo vigente."""
        if stable_id is None:
            return Response(
                {"detail": "Debe indicar stable_id para actualizar el catálogo."},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = SmileitCatalogEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            update_catalog_substituent(
                stable_id=stable_id,
                payload=cast(
                    SmileitSubstituentCreatePayload, serializer.validated_data
                ),
            )
        except ValueError as exc:
            error_message = str(exc)
            status_code = (
                status.HTTP_404_NOT_FOUND
                if "No existe" in error_message
                else status.HTTP_409_CONFLICT
            )
            return Response({"detail": error_message}, status=status_code)

        response_serializer = SmileitCatalogEntrySerializer(
            list_active_catalog_entries(), many=True
        )
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Gestionar Patrones Estructurales Smile-it",
        request=SmileitPatternEntryCreateSerializer,
        responses={
            200: SmileitPatternEntrySerializer(many=True),
            201: SmileitPatternEntrySerializer,
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=False, methods=["get", "post"], url_path="patterns")
    def patterns(self, request: Request) -> Response:
        """Lista o crea patrones estructurales activos de Smile-it."""
        if request.method.lower() == "get":
            serializer = SmileitPatternEntrySerializer(
                list_active_patterns(), many=True
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = SmileitPatternEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            created_pattern = create_pattern_entry(serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        response_serializer = SmileitPatternEntrySerializer(created_pattern)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Inspeccionar Estructura Smile-it",
        request=SmileitStructureInspectionRequestSerializer,
        responses={
            200: SmileitStructureInspectionResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=False, methods=["post"], url_path="inspect-structure")
    def inspect_structure(self, request: Request) -> Response:
        """Inspecciona molécula con propiedades rápidas y anotaciones por patrones."""
        serializer = SmileitStructureInspectionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        smiles_value = str(serializer.validated_data["smiles"])

        try:
            result = inspect_smiles_structure_with_patterns(
                smiles=smiles_value,
                patterns=list_active_patterns(),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        response_serializer = SmileitStructureInspectionResponseSerializer(result)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Crear Job Smile-it v2",
        request=SmileitJobCreateSerializer,
        responses={
            201: SmileitJobResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
            503: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job con bloques resueltos y cobertura total obligatoria."""
        serializer = SmileitJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = cast(SmileitJobCreatePayload, serializer.validated_data)

        try:
            resolved_blocks, references = _resolve_assignment_blocks(payload)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        pending_sites = _validate_effective_coverage(
            selected_sites=payload["selected_atom_indices"],
            resolved_blocks=resolved_blocks,
        )
        if len(pending_sites) > 0:
            return Response(
                {
                    "detail": (
                        "No se puede ejecutar la generación porque existen sitios "
                        f"sin cobertura efectiva: {pending_sites}."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        version = payload.get("version", DEFAULT_ALGORITHM_VERSION)
        parameters_payload: JSONMap = {
            "version": version,
            "principal_smiles": payload["principal_smiles"],
            "selected_atom_indices": payload["selected_atom_indices"],
            "assignment_blocks": cast(list[dict[str, object]], list(resolved_blocks)),
            "r_substitutes": payload["r_substitutes"],
            "num_bonds": payload["num_bonds"],
            "allow_repeated": False,
            "max_structures": payload["max_structures"],
            "site_overlap_policy": payload["site_overlap_policy"],
            "export_name_base": payload["export_name_base"],
            "export_padding": payload["export_padding"],
            "references": cast(dict[str, object], references),
        }

        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=version,
            parameters=parameters_payload,
        ).run()

        if submit_result.is_failure():
            error_message = submit_result.fold(
                on_failure=lambda error_value: str(error_value),
                on_success=lambda _: "Error desconocido al crear el job Smile-it.",
            )
            return Response(
                {"detail": error_message}, status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        job_handle = submit_result.get_or_else(None)
        if job_handle is None:
            return Response(
                {"detail": "No se pudo obtener el identificador del job Smile-it."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        job = get_object_or_404(
            ScientificJob, pk=job_handle.job_id, plugin_name=PLUGIN_NAME
        )
        response_serializer = SmileitJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job Smile-it",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job Smile-it.",
            )
        ],
        responses={
            200: SmileitJobResponseSerializer,
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera estado/resultados de un job Smile-it."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        response_serializer = SmileitJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar CSV de Estructuras Smile-it",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-csv")
    def report_csv(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Descarga CSV de estructuras derivadas para análisis tabular."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        content = _build_structures_csv(job)
        filename = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="structures",
            extension="csv",
        )
        return build_text_download_response(
            content=content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Export Principal SMILES Enumerado",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-smiles")
    def report_smiles(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Descarga archivo limpio NAME + NAME_XXXXX SMILES para DataWarrior."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        content = _build_enumerated_smiles_export(job)
        filename = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="enumerated",
            extension="smi",
        )
        return build_text_download_response(
            content=content,
            filename=filename,
            content_type="text/plain; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar CSV de Trazabilidad Smile-it",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-traceability")
    def report_traceability(
        self,
        request: Request,
        id: str | None = None,
    ) -> HttpResponse | Response:
        """Descarga auditoría sitio -> sustituyente aplicada por derivado."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        content = _build_traceability_csv(job)
        filename = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="traceability",
            extension="csv",
        )
        return build_text_download_response(
            content=content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Reporte LOG de Smile-it",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Descarga reporte técnico completo con logs y resumen de resultados."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = _build_structures_csv(job)

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
        summary="Descargar Reporte de Error Smile-it",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-error")
    def report_error(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Descarga reporte de error cuando el job Smile-it falla."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        error_content = build_job_error_report(job)
        if error_content is None:
            return Response(
                {"detail": "El job no tiene un error exportable o no ha fallado."},
                status=status.HTTP_409_CONFLICT,
            )

        filename = build_download_filename(
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

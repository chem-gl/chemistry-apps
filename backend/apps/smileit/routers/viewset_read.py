"""routers_pkg/viewset_read.py: Mixins de lectura y reportes para Smile-it.

Define retrieve, paginación de derivados y exportes para mantener
el ViewSet principal compacto y por capas.
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
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.models import ScientificJob
from apps.core.reporting import (
    build_download_filename,
    build_text_download_response,
    validate_job_for_csv_report,
)
from apps.core.schemas import ErrorResponseSerializer
from apps.core.types import JSONMap

from ..definitions import PLUGIN_NAME
from ..schemas import (
    SmileitGeneratedStructurePageSerializer,
    SmileitJobResponseSerializer,
)
from ..types import SmileitResult
from .exports import (
    build_derivations_images_zip,
    build_enumerated_smiles_export,
    build_smileit_summary_payload,
    build_structures_csv,
    build_traceability_csv,
    resolve_job_structure_by_index,
)


class SmileitReadActionsMixin:
    """Acciones GET y reportes binarios para jobs de Smile-it."""

    def build_csv_content(self, job: ScientificJob) -> str:
        """Delega a helper para CSV químico por derivado."""
        results_payload = cast(SmileitResult, job.results)
        return build_structures_csv(results_payload)

    @extend_schema(
        summary="Obtener Job Smile-it (resumen optimizado)",
        responses={200: SmileitJobResponseSerializer},
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Retorna estado del job sin lista completa de derivados para reducir payload."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        return Response(build_smileit_summary_payload(job), status=status.HTTP_200_OK)

    @extend_schema(
        summary="Listar derivados Smile-it paginados",
        parameters=[
            OpenApiParameter(
                name="offset",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Índice inicial absoluto (0-based).",
            ),
            OpenApiParameter(
                name="limit",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Tamaño de página (máximo 100).",
            ),
        ],
        responses={
            200: SmileitGeneratedStructurePageSerializer,
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="derivations")
    def derivations(self, request: Request, id: str | None = None) -> Response:
        """Entrega derivados por páginas para evitar respuestas gigantes en frontend."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        raw_offset = request.query_params.get("offset", "0")
        raw_limit = request.query_params.get("limit", "100")

        try:
            offset = max(0, int(raw_offset))
            limit = max(1, min(100, int(raw_limit)))
        except ValueError:
            return Response(
                {"detail": "offset y limit deben ser enteros válidos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results_payload = cast(SmileitResult, job.results)
        structures = results_payload.get("generated_structures", [])
        paged_structures = structures[offset : offset + limit]

        items: list[JSONMap] = []
        for relative_index, structure in enumerate(paged_structures):
            absolute_index = offset + relative_index
            items.append(
                {
                    "structure_index": absolute_index,
                    "smiles": str(structure.get("smiles", "")),
                    "name": str(structure.get("name", "")),
                    "placeholder_assignments": list(
                        structure.get("placeholder_assignments", [])
                    ),
                    "traceability": list(structure.get("traceability", [])),
                }
            )

        response_payload: JSONMap = {
            "total_generated": len(structures),
            "offset": offset,
            "limit": limit,
            "items": items,
        }
        serializer = SmileitGeneratedStructurePageSerializer(response_payload)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Renderizar SVG de un derivado Smile-it bajo demanda",
        parameters=[
            OpenApiParameter(
                name="structure_index",
                type=int,
                location=OpenApiParameter.PATH,
                required=True,
                description="Índice absoluto del derivado dentro del job.",
            ),
            OpenApiParameter(
                name="variant",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Variante de renderizado: 'thumb' para grid o 'detail' para modal/export.",
            ),
        ],
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=True,
        methods=["get"],
        url_path=r"derivations/(?P<structure_index>\d+)/svg",
    )
    def derivation_svg(
        self,
        request: Request,
        id: str | None = None,
        structure_index: str | None = None,
    ) -> HttpResponse | Response:
        """Genera SVG del derivado solicitado únicamente cuando frontend lo necesita."""
        from ..engine import (
            render_derivative_svg_with_substituent_highlighting,
            tint_svg,
        )

        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        try:
            resolved_index = int(structure_index or "")
        except ValueError:
            return Response(
                {"detail": "structure_index debe ser entero."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results_payload = cast(SmileitResult, job.results)
        structure = resolve_job_structure_by_index(results_payload, resolved_index)
        if structure is None:
            return Response(
                {"detail": "No existe derivado para structure_index solicitado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        principal_smiles = str(results_payload.get("principal_smiles", ""))
        derivative_smiles = str(structure.get("smiles", ""))
        placeholder_assignments = cast(
            list[dict[str, str | int]],
            structure.get("placeholder_assignments", []),
        )
        substituent_smiles_list = [
            str(assignment.get("substituent_smiles", ""))
            for assignment in placeholder_assignments
            if str(assignment.get("substituent_smiles", "")) != ""
        ]
        principal_site_atom_indices = [
            int(assignment.get("site_atom_index", -1))
            for assignment in placeholder_assignments
            if int(assignment.get("site_atom_index", -1)) >= 0
        ]

        variant = str(request.query_params.get("variant", "detail")).strip().lower()
        is_thumb = variant == "thumb"

        raw_svg = render_derivative_svg_with_substituent_highlighting(
            principal_smiles=principal_smiles,
            derivative_smiles=derivative_smiles,
            substituent_smiles_list=substituent_smiles_list,
            principal_site_atom_indices=principal_site_atom_indices,
            image_width=280 if is_thumb else 400,
            image_height=280 if is_thumb else 400,
        )
        svg = tint_svg(raw_svg, "#2f855a")
        if svg.strip() == "":
            return Response(
                {"detail": "No se pudo renderizar SVG para el derivado solicitado."},
                status=status.HTTP_409_CONFLICT,
            )

        return HttpResponse(svg, content_type="image/svg+xml; charset=utf-8")

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
        """Descarga archivo SMI/TXT con principal y derivados como lista simple de SMILES."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        results_payload = cast(SmileitResult, job.results)
        content = build_enumerated_smiles_export(results_payload)
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

        results_payload = cast(SmileitResult, job.results)
        content = build_traceability_csv(results_payload)
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
        summary="Descargar ZIP de imágenes SVG de derivados Smile-it",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-images-zip")
    def report_images_zip(
        self,
        request: Request,
        id: str | None = None,
    ) -> HttpResponse | Response:
        """Entrega ZIP de imágenes por backend para jobs extremadamente grandes."""
        job = get_object_or_404(ScientificJob, pk=id, plugin_name=PLUGIN_NAME)
        validation_error = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error}, status=status.HTTP_409_CONFLICT
            )

        results_payload = cast(SmileitResult, job.results)
        zip_content = build_derivations_images_zip(results_payload)
        filename = build_download_filename(
            plugin_name=PLUGIN_NAME,
            job_id=str(job.id),
            report_suffix="images",
            extension="zip",
        )
        response = HttpResponse(zip_content, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

"""routers_pkg/viewset_write.py: Mixins de escritura/configuración para Smile-it.

Define endpoints de creación de jobs y mantenimiento de catálogo/patrones,
separando la lógica de mutación del bloque de lectura/reportes.
"""

from __future__ import annotations

from typing import cast

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from ..catalog import (
    create_catalog_substituent,
    create_pattern_entry,
    list_active_catalog_entries,
    list_active_categories,
    list_active_patterns,
    update_catalog_substituent,
)
from ..definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from ..engine import inspect_smiles_structure_with_patterns
from ..schemas import (
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
from ..types import SmileitJobCreatePayload, SmileitSubstituentCreatePayload
from .assignment_resolution import (
    resolve_assignment_blocks,
    validate_effective_coverage,
)


class SmileitWriteActionsMixin:
    """Acciones de creación y administración de datos de Smile-it."""

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
            resolved_blocks, references = resolve_assignment_blocks(payload)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        pending_sites = validate_effective_coverage(
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

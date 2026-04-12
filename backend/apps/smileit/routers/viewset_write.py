"""routers_pkg/viewset_write.py: Mixins de escritura/configuración para Smile-it.

Define endpoints de creación de jobs y mantenimiento de catálogo/patrones,
separando la lógica de mutación del bloque de lectura/reportes.
"""

from __future__ import annotations

from typing import cast

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .._catalog_schemas import (
    SmileitCatalogEntryCreateSerializer,
    SmileitCatalogEntrySerializer,
    SmileitCategorySerializer,
    SmileitPatternEntryCreateSerializer,
    SmileitPatternEntrySerializer,
    SmileitStructureInspectionRequestSerializer,
    SmileitStructureInspectionResponseSerializer,
)
from ..catalog import (
    create_catalog_substituent,
    create_pattern_entry,
    delete_catalog_substituent,
    delete_pattern_entry,
    list_active_catalog_entries,
    list_active_categories,
    list_active_patterns,
    update_catalog_substituent,
    update_pattern_entry,
)
from ..definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from ..engine import inspect_smiles_structure_with_patterns
from ..schemas import SmileitJobCreateSerializer, SmileitJobResponseSerializer
from ..types import (
    SmileitJobCreatePayload,
    SmileitPatternCreatePayload,
    SmileitSubstituentCreatePayload,
)
from .assignment_resolution import (
    resolve_assignment_blocks,
    validate_effective_coverage,
)


class SmileitWriteActionsMixin:
    """Acciones de creación y administración de datos de Smile-it."""

    NOT_FOUND_TOKEN = "No existe"

    def _resolve_error_status(
        self,
        error_message: str,
        exc: Exception,
        *,
        map_permission_to_forbidden: bool,
    ) -> int:
        """Resuelve status HTTP para excepciones de dominio."""
        if self.NOT_FOUND_TOKEN in error_message:
            return status.HTTP_404_NOT_FOUND
        if map_permission_to_forbidden and isinstance(exc, PermissionError):
            return status.HTTP_403_FORBIDDEN
        return status.HTTP_409_CONFLICT

    def _error_response_from_exception(
        self,
        exc: Exception,
        *,
        map_permission_to_forbidden: bool,
    ) -> Response:
        """Construye respuesta de error homogénea para ValueError/PermissionError."""
        error_message = str(exc)
        status_code = self._resolve_error_status(
            error_message,
            exc,
            map_permission_to_forbidden=map_permission_to_forbidden,
        )
        return Response({"detail": error_message}, status=status_code)

    def _get_actor_info(
        self, request: Request
    ) -> tuple[int | None, str, str | None, list[int]]:
        """Extrae información del actor desde el request.

        Retorna:
            - actor_user_id: ID del usuario o None
            - actor_username: Nombre del usuario
            - actor_role: "root", "admin", "user", o None
            - actor_group_ids: Lista de IDs de grupos
        """
        is_authenticated = bool(getattr(request.user, "is_authenticated", False))
        actor_user_id = request.user.id if is_authenticated else None
        actor_username = request.user.username if is_authenticated else ""

        # Obtener rol desde el modelo UserAccount
        actor_role = None
        if is_authenticated:
            actor_role = getattr(request.user, "role", "user")

        # Obtener grupos
        actor_group_ids = []
        if is_authenticated:
            actor_group_ids = list(request.user.groups.values_list("id", flat=True))

        return actor_user_id, actor_username, actor_role, actor_group_ids

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
        actor_user_id, actor_username, actor_role, actor_group_ids = (
            self._get_actor_info(request)
        )

        if request.method.lower() == "get":
            serializer = SmileitCatalogEntrySerializer(
                list_active_catalog_entries(
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    actor_user_group_ids=actor_group_ids,
                ),
                many=True,
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = SmileitCatalogEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            created_entry = create_catalog_substituent(
                serializer.validated_data,
                actor_user_id=actor_user_id,
                actor_username=actor_username,
                actor_role=actor_role,
                actor_user_group_ids=actor_group_ids,
            )
        except (ValueError, PermissionError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        response_serializer = SmileitCatalogEntrySerializer(created_entry)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Actualizar o Eliminar Catálogo de Sustituyentes de Usuario",
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
            204: OpenApiResponse(description="Sustituyente eliminado correctamente."),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["patch", "delete"],
        url_path=r"catalog/(?P<stable_id>[^/.]+)",
    )
    def update_catalog(
        self, request: Request, stable_id: str | None = None
    ) -> Response:
        """Versiona (PATCH) o elimina lógicamente (DELETE) una entrada de catálogo."""
        if stable_id is None:
            return Response(
                {"detail": "Debe indicar stable_id para operar sobre el catálogo."},
                status=status.HTTP_409_CONFLICT,
            )

        actor_user_id, actor_username, actor_role, actor_group_ids = (
            self._get_actor_info(request)
        )

        if request.method.lower() == "delete":
            try:
                delete_catalog_substituent(
                    stable_id=stable_id,
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    actor_user_group_ids=actor_group_ids,
                )
            except (ValueError, PermissionError) as exc:
                return self._error_response_from_exception(
                    exc,
                    map_permission_to_forbidden=True,
                )

            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = SmileitCatalogEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            updated_entry = update_catalog_substituent(
                stable_id=stable_id,
                payload=cast(
                    SmileitSubstituentCreatePayload, serializer.validated_data
                ),
                actor_user_id=actor_user_id,
                actor_username=actor_username,
                actor_role=actor_role,
                actor_user_group_ids=actor_group_ids,
            )
        except (ValueError, PermissionError) as exc:
            return self._error_response_from_exception(
                exc,
                map_permission_to_forbidden=False,
            )

        response_serializer = SmileitCatalogEntrySerializer([updated_entry], many=True)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Gestionar Patrones Estructurales Smile-it",
        parameters=[
            OpenApiParameter(
                name="filter",
                type=str,
                location=OpenApiParameter.QUERY,
                description='Filtro de visibilidad: "show-all" (default) o "root-only" (solo root)',
                required=False,
            )
        ],
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
        actor_user_id, _, actor_role, actor_group_ids = self._get_actor_info(request)

        if request.method.lower() == "get":
            # Obtener filtro de query params
            filter_mode = request.query_params.get("filter", "show-all")
            if filter_mode not in {"show-all", "root-only"}:
                filter_mode = "show-all"

            serializer = SmileitPatternEntrySerializer(
                list_active_patterns(
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    actor_user_group_ids=actor_group_ids,
                    filter_mode=filter_mode,
                ),
                many=True,
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = SmileitPatternEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            created_pattern = create_pattern_entry(
                serializer.validated_data,
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                actor_user_group_ids=actor_group_ids,
            )
        except (ValueError, PermissionError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        response_serializer = SmileitPatternEntrySerializer(created_pattern)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Actualizar o Eliminar Patrón Estructural Smile-it",
        parameters=[
            OpenApiParameter(
                name="stable_id",
                type=str,
                location=OpenApiParameter.PATH,
                description="Stable ID del patrón a versionar; solo patrones editables se pueden actualizar.",
            )
        ],
        request=SmileitPatternEntryCreateSerializer,
        responses={
            200: SmileitPatternEntrySerializer,
            204: OpenApiResponse(description="Patrón eliminado correctamente."),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["patch", "delete"],
        url_path=r"patterns/(?P<stable_id>[^/.]+)",
    )
    def update_patterns(
        self, request: Request, stable_id: str | None = None
    ) -> Response:
        """Crea una nueva versión (PATCH) o elimina lógicamente (DELETE) un patrón."""
        if stable_id is None:
            return Response(
                {"detail": "Debe indicar stable_id para operar sobre el patrón."},
                status=status.HTTP_409_CONFLICT,
            )

        actor_user_id, _, actor_role, actor_group_ids = self._get_actor_info(request)

        if request.method.lower() == "delete":
            try:
                delete_pattern_entry(
                    stable_id=stable_id,
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    actor_user_group_ids=actor_group_ids,
                )
            except (ValueError, PermissionError) as exc:
                return self._error_response_from_exception(
                    exc,
                    map_permission_to_forbidden=True,
                )

            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = SmileitPatternEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            updated_pattern = update_pattern_entry(
                stable_id=stable_id,
                payload=cast(SmileitPatternCreatePayload, serializer.validated_data),
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                actor_user_group_ids=actor_group_ids,
            )
        except (ValueError, PermissionError) as exc:
            return self._error_response_from_exception(
                exc,
                map_permission_to_forbidden=True,
            )

        response_serializer = SmileitPatternEntrySerializer(updated_pattern)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

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

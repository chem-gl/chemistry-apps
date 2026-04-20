"""routers.py: Endpoints HTTP para CADMA Py.

Expone creación de jobs, administración de familias de referencia y acceso a
muestras legacy reutilizables sin mezclar lógica científica con el router.
"""

from __future__ import annotations

from typing import cast

from django.core.files.uploadedfile import SimpleUploadedFile, UploadedFile
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.artifacts import build_file_descriptor
from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.types import JSONMap

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .schemas import (
    CadmaCompoundAddSerializer,
    CadmaCompoundRowResponseSerializer,
    CadmaDeletionPreviewSerializer,
    CadmaPyJobCreateSerializer,
    CadmaPyJobResponseSerializer,
    CadmaReferenceLibraryForkSerializer,
    CadmaReferenceLibraryResponseSerializer,
    CadmaReferenceLibraryWriteSerializer,
    CadmaReferenceRowPatchSerializer,
    CadmaReferenceSampleImportSerializer,
    CadmaReferenceSamplePreviewRowSerializer,
    CadmaReferenceSampleSerializer,
)
from .services import (
    add_compound_to_library,
    build_compound_rows_from_payload,
    build_reference_artifacts_zip_bytes,
    create_library_from_sample,
    create_reference_library,
    deactivate_reference_library,
    fork_reference_library,
    get_reference_library_for_actor,
    list_reference_samples,
    list_visible_reference_libraries,
    preview_library_deletion,
    preview_reference_sample,
    preview_reference_sample_detail,
    ranking_to_csv_rows,
    remove_reference_row,
    serialize_reference_library,
    update_reference_library,
    update_reference_row,
)
from .types import CadmaPyJobCreatePayload, CadmaPyResult

_NOT_FOUND_MARKER = "No existe"

SOURCE_FILE_FIELDS: tuple[tuple[str, str], ...] = (
    ("combined_file", "combined_csv_text"),
    ("smiles_file", "smiles_csv_text"),
    ("toxicity_file", "toxicity_csv_text"),
    ("sa_file", "sa_csv_text"),
)
MISSING_LIBRARY_ID_MESSAGE = "Debes indicar el ID de la familia de referencia."


def _read_uploaded_text(uploaded_file: UploadedFile) -> str:
    file_bytes = uploaded_file.read()
    uploaded_file.seek(0)
    return file_bytes.decode("utf-8", errors="replace")


def _normalize_source_inputs(
    validated_data: dict[str, object],
) -> tuple[dict[str, str], list[tuple[str, UploadedFile]]]:
    resolved_texts: dict[str, str] = {}
    uploaded_files: list[tuple[str, UploadedFile]] = []

    for file_field, text_field in SOURCE_FILE_FIELDS:
        raw_file = validated_data.get(file_field)
        if raw_file is not None:
            uploaded_file = cast(UploadedFile, raw_file)
            resolved_texts[text_field] = _read_uploaded_text(uploaded_file)
            uploaded_files.append((file_field, uploaded_file))
            continue

        raw_text = str(validated_data.get(text_field, "")).strip()
        if raw_text == "":
            continue

        resolved_texts[text_field] = raw_text
        uploaded_files.append(
            (
                file_field,
                SimpleUploadedFile(
                    name=f"{text_field}.csv",
                    content=raw_text.encode("utf-8"),
                    content_type="text/csv",
                ),
            )
        )

    return resolved_texts, uploaded_files


@extend_schema(tags=["CADMAPy"])
class CadmaPyJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """API de CADMA Py con endpoints de job y CRUD de familias de referencia."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    plugin_name = PLUGIN_NAME
    response_serializer_class = CadmaPyJobResponseSerializer
    csv_report_suffix = "selection"
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def build_csv_content(self, job: ScientificJob) -> str:
        result_payload = cast(CadmaPyResult, job.results)
        return "\n".join(ranking_to_csv_rows(result_payload["ranking"]))

    @extend_schema(
        summary="Crear Job de CADMA Py",
        request=CadmaPyJobCreateSerializer,
        responses={
            201: CadmaPyJobResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    def create(self, request: Request) -> Response:
        """Encola un job de comparación contra una familia de referencia."""
        serializer = CadmaPyJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = cast(CadmaPyJobCreatePayload, serializer.validated_data)
        validated_data = cast(dict[str, object], serializer.validated_data)
        source_texts, uploaded_files = _normalize_source_inputs(validated_data)

        start_paused = bool(payload.get("start_paused", False))

        reference_library_id = str(payload["reference_library_id"]).strip()

        try:
            if reference_library_id.startswith("sample-"):
                sample_detail = preview_reference_sample_detail(
                    reference_library_id.removeprefix("sample-")
                )
                library_name = str(sample_detail["name"])
                disease_name = str(sample_detail["disease_name"])
                reference_rows = cast(JSONMap, sample_detail["rows"])
            else:
                reference_library = get_reference_library_for_actor(
                    reference_library_id,
                    request.user,
                )
                library_name = reference_library.name
                disease_name = reference_library.disease_name
                reference_rows = cast(JSONMap, reference_library.reference_rows)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        candidate_rows: list[JSONMap] = []
        if not start_paused:
            try:
                candidate_rows = build_compound_rows_from_payload(
                    payload={
                        **{
                            key: str(value)
                            for key, value in validated_data.items()
                            if isinstance(value, str)
                        },
                        **source_texts,
                    },
                    default_name_prefix=str(
                        payload.get("project_label", "Candidate batch")
                    ),
                    require_evidence=False,
                )
            except ValueError as exc:
                return Response(
                    {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
                )

        file_descriptors = [
            build_file_descriptor(field_name, uploaded_file)
            for field_name, uploaded_file in uploaded_files
        ]
        parameters_payload: JSONMap = {
            "project_label": str(payload.get("project_label", "")).strip(),
            "reference_library_id": reference_library_id,
            "library_name": library_name,
            "disease_name": disease_name,
            "reference_rows": reference_rows,
            "candidate_rows": cast(JSONMap, candidate_rows),
            "combined_csv_text": source_texts.get("combined_csv_text", ""),
            "smiles_csv_text": source_texts.get("smiles_csv_text", ""),
            "toxicity_csv_text": source_texts.get("toxicity_csv_text", ""),
            "sa_csv_text": source_texts.get("sa_csv_text", ""),
            "source_configs_json": str(payload.get("source_configs_json", "")),
            "score_config_json": str(payload.get("score_config_json", "")),
            "file_descriptors": cast(JSONMap, {"items": file_descriptors})["items"],
            "start_paused": start_paused,
        }

        if start_paused:
            return self.prepare_and_pause_with_artifacts(
                parameters_payload=parameters_payload,
                version_value=DEFAULT_ALGORITHM_VERSION,
                uploaded_files=uploaded_files,
            )

        return self.prepare_and_dispatch_with_artifacts(
            parameters_payload=parameters_payload,
            version_value=DEFAULT_ALGORITHM_VERSION,
            uploaded_files=uploaded_files,
        )

    @extend_schema(
        summary="Listar o Crear Familias de Referencia CADMA",
        request=CadmaReferenceLibraryWriteSerializer,
        responses={
            200: CadmaReferenceLibraryResponseSerializer(many=True),
            201: CadmaReferenceLibraryResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=False, methods=["get", "post"], url_path="reference-libraries")
    def reference_libraries(self, request: Request) -> Response:
        """Lista o crea familias de referencia visibles para el actor."""
        if request.method.lower() == "get":
            serializer = CadmaReferenceLibraryResponseSerializer(
                list_visible_reference_libraries(request.user),
                many=True,
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = CadmaReferenceLibraryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated_data = cast(dict[str, object], serializer.validated_data)
        source_texts, uploaded_files = _normalize_source_inputs(validated_data)
        payload_data: dict[str, str] = {
            **{
                key: str(value)
                for key, value in validated_data.items()
                if isinstance(value, str)
            },
            **source_texts,
        }
        try:
            library = create_reference_library(
                payload=payload_data,
                actor=request.user,
                uploaded_files=uploaded_files,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        response_serializer = CadmaReferenceLibraryResponseSerializer(
            serialize_reference_library(library, request.user)
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar, actualizar o eliminar una familia CADMA",
        request=CadmaReferenceLibraryWriteSerializer,
        responses={
            200: CadmaReferenceLibraryResponseSerializer,
            204: OpenApiResponse(description="Familia eliminada correctamente."),
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["get", "patch", "delete"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)",
    )
    def reference_library_detail(
        self, request: Request, library_id: str | None = None
    ) -> Response:
        """Opera sobre una familia concreta manteniendo las reglas RBAC."""
        if library_id is None:
            return Response(
                {"detail": MISSING_LIBRARY_ID_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if request.method.lower() == "get":
                library = get_reference_library_for_actor(library_id, request.user)
                serializer = CadmaReferenceLibraryResponseSerializer(
                    serialize_reference_library(library, request.user)
                )
                return Response(serializer.data, status=status.HTTP_200_OK)

            if request.method.lower() == "delete":
                cascade = str(request.query_params.get("cascade", "false")).lower() in (
                    "true",
                    "1",
                    "yes",
                )
                deactivate_reference_library(
                    library_id=library_id,
                    actor=request.user,
                    cascade=cascade,
                )
                return Response(status=status.HTTP_204_NO_CONTENT)

            serializer = CadmaReferenceLibraryWriteSerializer(
                data=request.data, partial=True
            )
            serializer.is_valid(raise_exception=True)
            validated_data = cast(dict[str, object], serializer.validated_data)
            source_texts, uploaded_files = _normalize_source_inputs(validated_data)
            payload_data: dict[str, str] = {
                **{
                    key: str(value)
                    for key, value in validated_data.items()
                    if isinstance(value, str)
                },
                **source_texts,
            }
            updated_library = update_reference_library(
                library_id=library_id,
                payload=payload_data,
                actor=request.user,
                uploaded_files=uploaded_files,
            )
            response_serializer = CadmaReferenceLibraryResponseSerializer(
                serialize_reference_library(updated_library, request.user)
            )
            return Response(response_serializer.data, status=status.HTTP_200_OK)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            error_status = (
                status.HTTP_404_NOT_FOUND
                if _NOT_FOUND_MARKER in str(exc)
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"detail": str(exc)}, status=error_status)

    @extend_schema(
        summary="Vista previa de eliminación de una familia con sus jobs vinculados",
        responses={
            200: CadmaDeletionPreviewSerializer,
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["get"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)/deletion-preview",
    )
    def reference_library_deletion_preview(
        self, request: Request, library_id: str | None = None
    ) -> Response:
        """Retorna los jobs vinculados a la familia para confirmar eliminación."""
        if library_id is None:
            return Response(
                {"detail": MISSING_LIBRARY_ID_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            preview = preview_library_deletion(
                library_id=library_id,
                actor=request.user,
            )
            serializer = CadmaDeletionPreviewSerializer(preview)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            error_status = (
                status.HTTP_404_NOT_FOUND
                if _NOT_FOUND_MARKER in str(exc)
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"detail": str(exc)}, status=error_status)

    @extend_schema(
        summary="Editar o eliminar una fila de compuesto por índice",
        request=CadmaReferenceRowPatchSerializer,
        responses={
            200: CadmaCompoundRowResponseSerializer,
            204: OpenApiResponse(description="Compuesto eliminado correctamente."),
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["patch", "delete"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)/rows/(?P<row_index>\d+)",
    )
    def patch_reference_row(
        self,
        request: Request,
        library_id: str | None = None,
        row_index: str | None = None,
    ) -> Response:
        """Actualiza campos editables (name, paper_reference, paper_url, evidence_note)."""
        if library_id is None or row_index is None:
            return Response(
                {"detail": "Se requiere library_id y row_index."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            if request.method.lower() == "delete":
                remove_reference_row(
                    library_id=library_id,
                    row_index=int(row_index),
                    actor=request.user,
                )
                return Response(status=status.HTTP_204_NO_CONTENT)

            serializer = CadmaReferenceRowPatchSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            updated_row = update_reference_row(
                library_id=library_id,
                row_index=int(row_index),
                patch=cast(dict[str, str], serializer.validated_data),
                actor=request.user,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            error_status = (
                status.HTTP_404_NOT_FOUND
                if _NOT_FOUND_MARKER in str(exc)
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"detail": str(exc)}, status=error_status)
        response_serializer = CadmaCompoundRowResponseSerializer(updated_row)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Agregar un compuesto nuevo a una familia de referencia",
        request=CadmaCompoundAddSerializer,
        responses={
            201: CadmaCompoundRowResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["post"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)/rows",
    )
    def add_reference_row(
        self, request: Request, library_id: str | None = None
    ) -> Response:
        """Agrega un compuesto con ADME auto-calculado por RDKit."""
        if library_id is None:
            return Response(
                {"detail": "Se requiere library_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CadmaCompoundAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            new_row = add_compound_to_library(
                library_id=library_id,
                smiles=str(data["smiles"]),
                name=str(data.get("name", "")),
                paper_reference=str(data.get("paper_reference", "")),
                paper_url=str(data.get("paper_url", "")),
                evidence_note=str(data.get("evidence_note", "")),
                toxicity_dt=data.get("toxicity_dt"),
                toxicity_m=data.get("toxicity_m"),
                toxicity_ld50=data.get("toxicity_ld50"),
                sa_score=data.get("sa_score"),
                actor=request.user,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            error_status = (
                status.HTTP_404_NOT_FOUND
                if _NOT_FOUND_MARKER in str(exc)
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"detail": str(exc)}, status=error_status)
        response_serializer = CadmaCompoundRowResponseSerializer(new_row)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Crear una copia editable de una familia compartida de solo lectura",
        request=CadmaReferenceLibraryForkSerializer,
        responses={
            201: CadmaReferenceLibraryResponseSerializer,
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["post"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)/fork",
    )
    def fork_reference_library_detail(
        self, request: Request, library_id: str | None = None
    ) -> Response:
        """Genera una copia editable para el actor sin alterar la familia compartida original."""
        if library_id is None:
            return Response(
                {"detail": MISSING_LIBRARY_ID_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CadmaReferenceLibraryForkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            library = fork_reference_library(
                library_id=library_id,
                actor=request.user,
                new_name=str(serializer.validated_data.get("new_name", "")),
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        response_serializer = CadmaReferenceLibraryResponseSerializer(
            serialize_reference_library(library, request.user)
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Descargar ZIP de archivos fuente de una familia de referencia",
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY),
            403: OpenApiResponse(response=ErrorResponseSerializer),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["get"],
        url_path=r"reference-libraries/(?P<library_id>[^/.]+)/report-inputs",
    )
    def reference_library_inputs(
        self, request: Request, library_id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega un ZIP con todos los archivos fuente guardados para una familia."""
        if library_id is None:
            return Response(
                {"detail": MISSING_LIBRARY_ID_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            library = get_reference_library_for_actor(library_id, request.user)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        if library.source_files.count() == 0:
            return Response(
                {"detail": "La familia no tiene archivos fuente persistidos."},
                status=status.HTTP_409_CONFLICT,
            )

        zip_bytes = build_reference_artifacts_zip_bytes(library=library)
        response = HttpResponse(zip_bytes, content_type="application/zip")
        response["Content-Disposition"] = (
            f'attachment; filename="cadma_py_reference_{library.id}_inputs.zip"'
        )
        return response

    @extend_schema(
        summary="Listar muestras legacy disponibles para CADMA Py",
        responses={200: CadmaReferenceSampleSerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="reference-samples")
    def reference_samples(self, request: Request) -> Response:
        """Expone datasets de ejemplo tomados del directorio deprecated."""
        serializer = CadmaReferenceSampleSerializer(list_reference_samples(), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Vista previa de compuestos de una muestra legacy",
        responses={
            200: CadmaReferenceSamplePreviewRowSerializer(many=True),
            400: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="reference-samples/(?P<sample_key>[a-z]+)/preview",
    )
    def preview_reference_sample(
        self, request: Request, sample_key: str = ""
    ) -> Response:
        """Devuelve name + SMILES de cada fila del CSV legacy para vista previa."""
        try:
            rows = preview_reference_sample(sample_key)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        serializer = CadmaReferenceSamplePreviewRowSerializer(rows, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Ver detalle completo de una muestra legacy sin importarla",
        responses={
            200: CadmaReferenceLibraryResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="reference-samples/(?P<sample_key>[a-z]+)/detail",
    )
    def reference_sample_detail(
        self, request: Request, sample_key: str = ""
    ) -> Response:
        """Entrega el mismo detalle rico de familia para las muestras bundled seed."""
        try:
            sample_view = preview_reference_sample_detail(sample_key)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        serializer = CadmaReferenceLibraryResponseSerializer(sample_view)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Importar una muestra legacy como familia de referencia",
        request=CadmaReferenceSampleImportSerializer,
        responses={
            201: CadmaReferenceLibraryResponseSerializer,
            400: OpenApiResponse(response=ErrorResponseSerializer),
            403: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=False, methods=["post"], url_path="reference-samples/import")
    def import_reference_sample(self, request: Request) -> Response:
        """Crea una familia visible para el actor a partir de un CSV example."""
        serializer = CadmaReferenceSampleImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            library = create_library_from_sample(
                sample_key=str(serializer.validated_data["sample_key"]),
                actor=request.user,
                new_name=str(serializer.validated_data.get("new_name", "")),
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        response_serializer = CadmaReferenceLibraryResponseSerializer(
            serialize_reference_library(library, request.user)
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

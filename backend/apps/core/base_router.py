"""base_router.py: Mixin reutilizable que elimina duplicación en routers de apps científicas.

Objetivo del archivo:
- Centralizar los endpoints comunes (retrieve, report-csv, report-log, report-error)
  que se repiten idénticamente en TODAS las apps científicas.
- Proveer helpers para el patrón submit_result, report-inputs y persistencia de artefactos.
- Reducir cada router de app a solo: create() + build_csv_content() específicos.

Cómo se usa:
1. Cada ViewSet de app hereda de ScientificAppViewSetMixin + viewsets.ViewSet.
2. Definir como atributos de clase:
   - plugin_name: str
   - response_serializer_class: type[Serializer]
3. Implementar build_csv_content(job) retornando el CSV como str.
4. Implementar create() con la lógica de validación y dispatch propia de la app.
5. Los endpoints retrieve, report-csv, report-log y report-error quedan heredados.
6. Usar handle_submit_result() para eliminar el patrón duplicado de submit_result.
7. Apps con artefactos de archivo heredan report_inputs() y usan persist_artifacts_and_dispatch().
"""

from __future__ import annotations

from django.core.files.uploadedfile import UploadedFile
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    OpenApiTypes,
    extend_schema,
)
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .artifacts import ScientificInputArtifactStorageService
from .declarative_api import DeclarativeJobAPI
from .identity.services import AuthorizationService
from .models import ScientificJob
from .reporting import (
    build_download_filename,
    build_job_error_report,
    build_job_log_report,
    build_text_download_response,
    validate_job_for_csv_report,
)
from .schemas import ErrorResponseSerializer
from .tasks import dispatch_scientific_job
from .types import DomainError, JobHandle, JSONMap, Result


class ScientificAppViewSetMixin:
    """Mixin que provee endpoints retrieve y reportes estándar para apps científicas.

    Atributos requeridos en la subclase:
    - plugin_name: str → nombre del plugin registrado en PluginRegistry.
    - response_serializer_class: type[serializers.Serializer] → serializer de respuesta.

    Métodos que la subclase DEBE implementar:
    - build_csv_content(job: ScientificJob) -> str → construye CSV específico de la app.
    - create(request: Request) -> Response → endpoint de creación de job.
    """

    plugin_name: str
    response_serializer_class: type[serializers.Serializer]
    csv_report_suffix: str = "report"

    def get_job_queryset(self) -> "viewsets.ViewSet.queryset":
        """Devuelve queryset por plugin y alcance de visibilidad del actor."""
        base_queryset = ScientificJob.objects.filter(plugin_name=self.plugin_name)
        request_obj = getattr(self, "request", None)
        actor = getattr(request_obj, "user", None)

        if bool(getattr(actor, "is_authenticated", False)):
            actor_visible_ids = AuthorizationService.get_visible_jobs(
                actor=actor
            ).values_list("id", flat=True)
            return base_queryset.filter(id__in=actor_visible_ids)

        return base_queryset

    def get_job_or_404(self, job_id: str | None) -> ScientificJob:
        """Obtiene un job del plugin validando permisos cuando hay actor autenticado."""
        job = get_object_or_404(
            ScientificJob,
            pk=job_id,
            plugin_name=self.plugin_name,
        )
        request_obj = getattr(self, "request", None)
        actor = getattr(request_obj, "user", None)

        if bool(
            getattr(actor, "is_authenticated", False)
        ) and not AuthorizationService.can_view_job(actor=actor, job=job):
            from django.http import Http404

            raise Http404("Job no encontrado.")

        return job

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye el CSV específico de la app. Debe ser implementado por subclases."""
        raise NotImplementedError(
            f"{self.__class__.__name__} debe implementar build_csv_content()"
        )

    @extend_schema(
        summary="Consultar Job",
        description="Devuelve estado, progreso y resultados del job por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job.",
            )
        ],
        responses={200: None, 404: OpenApiResponse(response=ErrorResponseSerializer)},
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera un job por UUID filtrando por plugin de esta app."""
        job: ScientificJob = self.get_job_or_404(id)
        response_serializer = self.response_serializer_class(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Descargar Reporte CSV",
        description="Descarga CSV con resultados del job. Solo aplica para estado completed.",
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY, description="Archivo CSV."
            ),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-csv")
    def report_csv(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega CSV de resultados cuando el job terminó correctamente."""
        job: ScientificJob = self.get_job_or_404(id)

        validation_error: str | None = validate_job_for_csv_report(job)
        if validation_error is not None:
            return Response(
                {"detail": validation_error},
                status=status.HTTP_409_CONFLICT,
            )

        csv_content: str = self.build_csv_content(job)
        filename: str = build_download_filename(
            plugin_name=self.plugin_name,
            job_id=str(job.id),
            report_suffix=self.csv_report_suffix,
            extension="csv",
        )
        return build_text_download_response(
            content=csv_content,
            filename=filename,
            content_type="text/csv; charset=utf-8",
        )

    @extend_schema(
        summary="Descargar Reporte LOG",
        description=(
            "Descarga log técnico con parámetros de entrada, estado, "
            "resultados y eventos de ejecución."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY, description="Log de auditoría."
            ),
            404: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-log")
    def report_log(self, request: Request, id: str | None = None) -> HttpResponse:
        """Entrega reporte textual de auditoría para el job solicitado."""
        job: ScientificJob = self.get_job_or_404(id)

        csv_content: str | None = None
        if validate_job_for_csv_report(job) is None:
            csv_content = self.build_csv_content(job)

        report_content: str = build_job_log_report(job=job, csv_content=csv_content)
        filename: str = build_download_filename(
            plugin_name=self.plugin_name,
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
        summary="Descargar Reporte de Error",
        description=(
            "Descarga reporte de error para jobs failed con error_trace. "
            "Incluye parámetros de entrada y detalle del fallo."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY, description="Reporte de error."
            ),
            404: OpenApiResponse(response=ErrorResponseSerializer),
            409: OpenApiResponse(response=ErrorResponseSerializer),
        },
    )
    @action(detail=True, methods=["get"], url_path="report-error")
    def report_error(
        self, request: Request, id: str | None = None
    ) -> HttpResponse | Response:
        """Entrega reporte de error cuando el job terminó en failed."""
        job: ScientificJob = self.get_job_or_404(id)

        error_report: str | None = build_job_error_report(job)
        if error_report is None:
            return Response(
                {
                    "detail": (
                        "El reporte de error solo está disponible para jobs failed "
                        "con error_trace persistido."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        filename: str = build_download_filename(
            plugin_name=self.plugin_name,
            job_id=str(job.id),
            report_suffix="error",
            extension="log",
        )
        return build_text_download_response(
            content=error_report,
            filename=filename,
            content_type="text/plain; charset=utf-8",
        )

    # ── Helpers para eliminar duplicación en routers concretos ────────

    def handle_submit_result(
        self,
        submit_result: Result[JobHandle[JSONMap], DomainError],
        response_serializer_class: type[serializers.Serializer],
    ) -> Response:
        """Procesa el resultado de DeclarativeJobAPI.submit_job() y retorna la Response HTTP.

        Elimina el bloque de 24+ líneas duplicado en cada router de app simple.
        Retorna 503 si falla el submit, 201 con el job serializado si tiene éxito.
        """
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
            plugin_name=self.plugin_name,
        )
        response_serializer = response_serializer_class(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def persist_artifacts_and_dispatch(
        self,
        created_job: ScientificJob,
        uploaded_files: list[tuple[str, UploadedFile]],
        job_handle: JobHandle[JSONMap],
    ) -> Response | None:
        """Persiste archivos de entrada en DB y despacha el job al broker.

        Retorna None si todo fue correcto.
        Retorna Response de error 400 si falla la persistencia de artefactos
        (y marca el job como failed).
        Elimina el bloque de 60+ líneas duplicado entre easy_rate y marcus.
        """
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
        return None

    def prepare_and_dispatch_with_artifacts(
        self,
        parameters_payload: JSONMap,
        version_value: str,
        uploaded_files: list[tuple[str, UploadedFile]],
    ) -> Response:
        """Flujo completo: crear job → persistir artefactos → despachar → responder.

        Centraliza el bloque de 36+ líneas duplicado entre Easy-rate y Marcus.
        Usa self.plugin_name y self.response_serializer_class definidos en la subclase.

        Retorna 503 si falla la preparación del job, 400 si falla la persistencia de
        artefactos, o 201 con el job serializado si todo termina exitosamente.
        """
        declarative_api = DeclarativeJobAPI(dispatch_callback=dispatch_scientific_job)
        prepare_result = declarative_api.prepare_job(
            plugin=self.plugin_name,
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

        artifact_error = self.persist_artifacts_and_dispatch(
            created_job=created_job,
            uploaded_files=uploaded_files,
            job_handle=job_handle,
        )
        if artifact_error is not None:
            return artifact_error

        created_job.refresh_from_db()
        response_serializer = self.response_serializer_class(created_job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Descargar Entradas Originales ZIP",
        description=(
            "Descarga ZIP con todos los archivos de entrada persistidos y manifest.json "
            "para reproducibilidad/reintento."
        ),
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo ZIP con entradas persistidas del job.",
            ),
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job no encontrado.",
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
        """Entrega ZIP de artefactos de entrada asociados al job. Heredado por apps con archivos."""
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
            plugin_name=self.plugin_name,
            job_id=str(job.id),
            report_suffix="inputs",
            extension="zip",
        )

        response = HttpResponse(zip_bytes, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

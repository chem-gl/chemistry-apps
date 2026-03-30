"""base_router.py: Mixin reutilizable que elimina duplicación en routers de apps científicas.

Objetivo del archivo:
- Centralizar los endpoints comunes (retrieve, report-csv, report-log, report-error)
  que se repiten idénticamente en TODAS las apps científicas.
- Reducir cada router de app a solo: create() + build_csv_content() específicos.

Cómo se usa:
1. Cada ViewSet de app hereda de ScientificAppViewSetMixin + viewsets.ViewSet.
2. Definir como atributos de clase:
   - plugin_name: str
   - response_serializer_class: type[Serializer]
3. Implementar build_csv_content(job) retornando el CSV como str.
4. Implementar create() con la lógica de validación y dispatch propia de la app.
5. Los endpoints retrieve, report-csv, report-log y report-error quedan heredados.
"""

from __future__ import annotations

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

from .models import ScientificJob
from .reporting import (
    build_download_filename,
    build_job_error_report,
    build_job_log_report,
    build_text_download_response,
    validate_job_for_csv_report,
)
from .schemas import ErrorResponseSerializer


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
        """Devuelve el queryset base filtrado por plugin."""
        return ScientificJob.objects.filter(plugin_name=self.plugin_name)

    def get_job_or_404(self, job_id: str | None) -> ScientificJob:
        """Obtiene un job filtrando por plugin_name o lanza 404."""
        return get_object_or_404(
            ScientificJob,
            pk=job_id,
            plugin_name=self.plugin_name,
        )

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

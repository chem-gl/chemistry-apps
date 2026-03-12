"""routers.py: Endpoints HTTP dedicados para molar_fractions.

Objetivo del archivo:
- Exponer creación/consulta de jobs sin mezclar lógica científica en la capa API.

Cómo se usa:
1. Validar request con serializer de la app.
2. Delegar creación a `DeclarativeJobAPI`.
3. Encolar con `dispatch_scientific_job` y responder contrato tipado.
"""

from typing import cast

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from .definitions import PLUGIN_NAME
from .schemas import (
    MolarFractionsJobCreateSerializer,
    MolarFractionsJobResponseSerializer,
)
from .types import MolarFractionsJobCreatePayload


@extend_schema(tags=["MolarFractions"])
class MolarFractionsJobViewSet(viewsets.ViewSet):
    """Expone endpoints de fracciones molares para ejecución asíncrona."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Crear Job de Molar Fractions",
        description=(
            "Crea un job asíncrono para calcular fracciones molares f0..fn en "
            "un pH único o en un rango de pH."
        ),
        request=MolarFractionsJobCreateSerializer,
        responses={
            201: MolarFractionsJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de molar_fractions.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job molar_fractions y conserva trazabilidad de encolado."""
        serializer = MolarFractionsJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: MolarFractionsJobCreatePayload = cast(
            MolarFractionsJobCreatePayload,
            serializer.validated_data,
        )

        version_value: str = validated_payload["version"]
        ph_mode: str = validated_payload["ph_mode"]

        parameters_payload: JSONMap = {
            "pka_values": validated_payload["pka_values"],
            "ph_mode": ph_mode,
        }
        if ph_mode == "single":
            parameters_payload["ph_value"] = validated_payload["ph_value"]
        else:
            parameters_payload["ph_min"] = validated_payload["ph_min"]
            parameters_payload["ph_max"] = validated_payload["ph_max"]
            parameters_payload["ph_step"] = validated_payload["ph_step"]

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

        response_serializer = MolarFractionsJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Molar Fractions",
        description="Devuelve estado, progreso y resultados del job por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job de molar_fractions.",
            )
        ],
        responses={
            200: MolarFractionsJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de molar_fractions no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera job por UUID filtrando por plugin molar_fractions."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = MolarFractionsJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

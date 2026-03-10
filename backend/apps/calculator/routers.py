"""routers.py: Endpoints de calculadora con contrato estricto por app."""

from typing import cast

from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.services import JobService
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from .definitions import PLUGIN_NAME
from .schemas import CalculatorJobCreateSerializer, CalculatorJobResponseSerializer
from .types import CalculatorJobCreatePayload


@extend_schema(tags=["Calculator"])
class CalculatorJobViewSet(viewsets.ViewSet):
    """Expone endpoints HTTP por app para crear/consultar jobs de calculadora."""

    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    @extend_schema(
        summary="Crear Job de Calculadora",
        description=(
            "Recibe parámetros estrictos de calculadora y despacha el trabajo "
            "en background cuando no existe caché."
        ),
        request=CalculatorJobCreateSerializer,
        responses={
            201: CalculatorJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de calculadora.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea un job de calculadora con contrato estricto por app."""
        serializer = CalculatorJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: CalculatorJobCreatePayload = cast(
            CalculatorJobCreatePayload, serializer.validated_data
        )
        version_value: str = validated_payload["version"]

        parameters_payload: JSONMap = {
            "op": validated_payload["op"],
            "a": validated_payload["a"],
            "b": validated_payload["b"],
        }

        job: ScientificJob = JobService.create_job(
            plugin_name=PLUGIN_NAME,
            version=version_value,
            parameters=parameters_payload,
        )

        if job.status == "pending":
            dispatch_scientific_job(str(job.id))

        response_serializer = CalculatorJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Consultar Job de Calculadora",
        description="Devuelve estado y resultado del job de calculadora por UUID.",
        parameters=[
            OpenApiParameter(
                name="id",
                type=str,
                location=OpenApiParameter.PATH,
                description="UUID del job de calculadora.",
            )
        ],
        responses={
            200: CalculatorJobResponseSerializer,
            404: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Job de calculadora no encontrado.",
            ),
        },
    )
    def retrieve(self, request: Request, id: str | None = None) -> Response:
        """Recupera un job de calculadora existente por id."""
        job: ScientificJob = get_object_or_404(
            ScientificJob,
            pk=id,
            plugin_name=PLUGIN_NAME,
        )
        response_serializer = CalculatorJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

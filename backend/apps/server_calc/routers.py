"""routers.py: Endpoints HTTP dedicados para la app Server Calc (solo admin).

Este módulo usa ScientificAppViewSetMixin para heredar los endpoints comunes
(retrieve, report-csv, report-log, report-error) y define solo:
1. create() con validación propia de Server Calc.
2. build_csv_content() con formato CSV de entradas/salidas del cálculo.
3. Permiso IsServerCalcAdmin: solo root/admin pueden usar estos endpoints.
"""

from typing import cast

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.identity.services.authorization_service import AuthorizationService
from apps.core.models import ScientificJob
from apps.core.schemas import ErrorResponseSerializer
from apps.core.tasks import dispatch_scientific_job
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME
from .schemas import ServerCalcJobCreateSerializer, ServerCalcJobResponseSerializer
from .types import ServerCalcCalculationResult, ServerCalcJobCreatePayload


class IsServerCalcAdmin(BasePermission):
    """Permite solo a root/admin operar la app Server Calc."""

    message = "Server Calc está restringido a administradores."

    def has_permission(self, request: Request, view: object) -> bool:
        """Valida rol admin sobre el actor autenticado."""
        actor = getattr(request, "user", None)
        if not bool(getattr(actor, "is_authenticated", False)):
            return False
        return AuthorizationService.is_root(actor) or AuthorizationService.is_admin(
            actor
        )


@extend_schema(tags=["ServerCalc"])
class ServerCalcJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    """Endpoints HTTP de Server Calc. Hereda retrieve y reportes del mixin."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = ServerCalcJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"
    permission_classes = [IsAuthenticated, IsServerCalcAdmin]

    def build_csv_content(self, job: ScientificJob) -> str:
        """Construye CSV tabular de entradas y salidas del cálculo Server Calc."""
        result_payload: ServerCalcCalculationResult = cast(
            ServerCalcCalculationResult, job.results
        )
        parameters_payload: JSONMap = cast(JSONMap, job.parameters)
        metadata_payload: JSONMap = cast(JSONMap, result_payload.get("metadata", {}))

        csv_lines: list[str] = [
            "a,op,b,result,executed_on,file_name,file_path",
            (
                f"{float(parameters_payload['a']):.8f},"
                f"{parameters_payload.get('op', '')},"
                f"{float(parameters_payload['b']):.8f},"
                f"{float(result_payload['result']):.8f},"
                f"{metadata_payload.get('executed_on', '')},"
                f"{result_payload.get('file_name') or ''},"
                f"{result_payload.get('file_path') or ''}"
            ),
        ]

        return "\n".join(csv_lines)

    @extend_schema(
        summary="Crear Job de Server Calc",
        description=(
            "Crea un job asíncrono para calcular a op b en el servidor "
            "remoto qta vía SSH, con fallback local si la conexión falla. "
            "Solo administradores."
        ),
        request=ServerCalcJobCreateSerializer,
        responses={
            201: ServerCalcJobResponseSerializer,
            400: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Error de validación del contrato de Server Calc.",
            ),
            403: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="Solo administradores pueden usar Server Calc.",
            ),
            503: OpenApiResponse(
                response=ErrorResponseSerializer,
                description="No fue posible encolar o crear el job.",
            ),
        },
    )
    def create(self, request: Request) -> Response:
        """Crea job de Server Calc preservando parámetros de entrada."""
        serializer = ServerCalcJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_payload: ServerCalcJobCreatePayload = cast(
            ServerCalcJobCreatePayload,
            serializer.validated_data,
        )

        parameters_payload: JSONMap = {
            "a": validated_payload["a"],
            "op": validated_payload["op"],
            "b": validated_payload["b"],
        }

        declarative_api = DeclarativeJobAPI(
            dispatch_callback=dispatch_scientific_job,
        )
        owner_id, group_id = self.resolve_actor_job_scope(request)
        submit_result = declarative_api.submit_job(
            plugin=PLUGIN_NAME,
            version=validated_payload["version"],
            parameters=parameters_payload,
            owner_id=owner_id,
            group_id=group_id,
        ).run()

        return self.handle_submit_result(submit_result, ServerCalcJobResponseSerializer)

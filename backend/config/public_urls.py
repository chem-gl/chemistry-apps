"""public_urls.py: Rutas públicas (sin login) de las apps libres — fase 1.

Punto de composición que crea la variante pública de cada ViewSet científico.
Vive en `config/` para que `apps/core` no dependa de apps científicas.

Contrato:
- ``POST /api/public/<app>/jobs/`` crea un job anónimo y lo despacha.
- ``GET  /api/public/<app>/jobs/<uuid>/`` consulta el job por capability URL.
- ``GET  /api/public/<app>/jobs/<uuid>/report-*`` descarga resultados.
- ``GET  /api/public/smileit/jobs/catalog|categories|patterns`` referencia de
  solo lectura (la escritura del catálogo sigue exigiendo cuenta).
- ``GET  /api/public/catalog/`` describe el modo abierto (apps y límites).

Las anotaciones `@extend_schema` viven aquí porque el mixin público redefine
``create`` y hereda un ``retrieve`` sin serializer de respuesta: sin ellas, el
cliente OpenAPI generaría operaciones sin request/response y el frontend no
podría despachar en modo libre.
"""

from __future__ import annotations

from django.conf import settings
from django.urls import path
from drf_spectacular.utils import (
    OpenApiResponse,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.routers import DefaultRouter
from rest_framework.views import APIView

from apps.core.app_registry import ScientificAppRegistry
from apps.core.public_api import PublicAppViewSetMixin
from apps.core.schemas import ErrorResponseSerializer
from apps.core.throttling import AnonymousReadRateThrottle
from apps.easy_rate.routers import EasyRateJobViewSet
from apps.easy_rate.schemas import (
    EasyRateJobCreateSerializer,
    EasyRateJobResponseSerializer,
)
from apps.marcus.routers import MarcusJobViewSet
from apps.marcus.schemas import MarcusJobCreateSerializer, MarcusJobResponseSerializer
from apps.molar_fractions.routers import MolarFractionsJobViewSet
from apps.molar_fractions.schemas import (
    MolarFractionsJobCreateSerializer,
    MolarFractionsJobResponseSerializer,
)
from apps.sa_score.routers import SaScoreJobViewSet
from apps.sa_score.schemas import SaScoreJobCreateSerializer, SaScoreJobResponseSerializer
from apps.smileit._catalog_schemas import (
    SmileitCatalogEntrySerializer,
    SmileitCategorySerializer,
    SmileitPatternEntrySerializer,
)
from apps.smileit.routers.viewset import SmileitJobViewSet
from apps.smileit.schemas import SmileitJobCreateSerializer, SmileitJobResponseSerializer
from apps.toxicity_properties.routers import ToxicityPropertiesJobViewSet
from apps.toxicity_properties.schemas import (
    ToxicityJobCreateSerializer,
    ToxicityJobResponseSerializer,
)
from apps.tunnel.routers import TunnelJobViewSet
from apps.tunnel.schemas import TunnelJobCreateSerializer, TunnelJobResponseSerializer

# Claves de ruta de las apps disponibles en modo abierto. El orden define el
# catálogo público y debe coincidir con los ViewSets registrados abajo.
PUBLIC_APP_ROUTE_KEYS: tuple[str, ...] = (
    "molar-fractions",
    "tunnel",
    "easy-rate",
    "marcus",
    "smileit",
    "sa-score",
    "toxicity-properties",
)


def _public_job_schema(
    *,
    tag: str,
    request_serializer: type | None,
    response_serializer: type,
):
    """Anota ``create``/``retrieve`` del ViewSet público de una app.

    Se aplica como decorador de clase en cada vista pública para que el
    contrato OpenAPI refleje el request real y el serializer de respuesta del
    job (el mixin público tapa la anotación original de ``create``).
    """
    return extend_schema_view(
        create=extend_schema(
            tags=[tag],
            request=request_serializer,
            responses={
                201: response_serializer,
                400: OpenApiResponse(
                    response=ErrorResponseSerializer,
                    description="Parámetros inválidos.",
                ),
                413: OpenApiResponse(
                    response=ErrorResponseSerializer,
                    description="Carga o parámetros por encima del tope del modo abierto.",
                ),
                429: OpenApiResponse(
                    response=ErrorResponseSerializer,
                    description="Cuota de despachos o de concurrencia agotada.",
                ),
                503: OpenApiResponse(
                    response=ErrorResponseSerializer,
                    description="No fue posible crear o encolar el job.",
                ),
            },
        ),
        retrieve=extend_schema(
            tags=[tag],
            responses={
                200: response_serializer,
                404: OpenApiResponse(
                    response=ErrorResponseSerializer,
                    description="Job inexistente, ya expirado o no anónimo.",
                ),
            },
        ),
    )


@_public_job_schema(
    tag="MolarFractions",
    request_serializer=MolarFractionsJobCreateSerializer,
    response_serializer=MolarFractionsJobResponseSerializer,
)
class PublicMolarFractionsJobViewSet(
    PublicAppViewSetMixin, MolarFractionsJobViewSet
):
    """Versión sin login de Molar Fractions."""


@_public_job_schema(
    tag="Tunnel",
    request_serializer=TunnelJobCreateSerializer,
    response_serializer=TunnelJobResponseSerializer,
)
class PublicTunnelJobViewSet(PublicAppViewSetMixin, TunnelJobViewSet):
    """Versión sin login de Tunnel Effect."""


@_public_job_schema(
    tag="EasyRate",
    request_serializer=EasyRateJobCreateSerializer,
    response_serializer=EasyRateJobResponseSerializer,
)
class PublicEasyRateJobViewSet(PublicAppViewSetMixin, EasyRateJobViewSet):
    """Versión sin login de Easy-rate."""


@_public_job_schema(
    tag="Marcus",
    request_serializer=MarcusJobCreateSerializer,
    response_serializer=MarcusJobResponseSerializer,
)
class PublicMarcusJobViewSet(PublicAppViewSetMixin, MarcusJobViewSet):
    """Versión sin login de Marcus Theory."""


@_public_job_schema(
    tag="Smileit",
    request_serializer=SmileitJobCreateSerializer,
    response_serializer=SmileitJobResponseSerializer,
)
class PublicSmileitJobViewSet(PublicAppViewSetMixin, SmileitJobViewSet):
    """Versión sin login de Smileit (catálogo y patrones solo lectura)."""

    @extend_schema(
        summary="Listar Categorías Químicas de Smile-it (público)",
        responses={200: SmileitCategorySerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="categories")
    def categories(self, request: Request) -> Response:
        """Solo lectura: el modo abierto no crea ni edita categorías."""
        return super().categories(request)

    @extend_schema(
        summary="Listar Catálogo de Sustituyentes (público)",
        responses={200: SmileitCatalogEntrySerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="catalog")
    def catalog(self, request: Request) -> Response:
        """Solo lectura: devuelve lo visible para un actor anónimo (seed/root)."""
        return super().catalog(request)

    @extend_schema(
        summary="Listar Patrones Estructurales (público)",
        responses={200: SmileitPatternEntrySerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="patterns")
    def patterns(self, request: Request) -> Response:
        """Solo lectura: el filtro `root-only` no aplica a actores anónimos."""
        return super().patterns(request)


@_public_job_schema(
    tag="SAScore",
    request_serializer=SaScoreJobCreateSerializer,
    response_serializer=SaScoreJobResponseSerializer,
)
class PublicSaScoreJobViewSet(PublicAppViewSetMixin, SaScoreJobViewSet):
    """Versión sin login de SA Score."""


@_public_job_schema(
    tag="ToxicityProperties",
    request_serializer=ToxicityJobCreateSerializer,
    response_serializer=ToxicityJobResponseSerializer,
)
class PublicToxicityPropertiesJobViewSet(
    PublicAppViewSetMixin, ToxicityPropertiesJobViewSet
):
    """Versión sin login de Toxicity Properties."""


class PublicCatalogView(APIView):
    """Describe el modo abierto: apps disponibles y límites vigentes.

    Devuelve solo datos machine-readable (las advertencias de privacidad y los
    textos viven en el i18n del frontend).
    """

    permission_classes = [AllowAny]
    authentication_classes: list[type] = []
    throttle_classes = [AnonymousReadRateThrottle]

    @extend_schema(
        tags=["Public"],
        summary="Catálogo del modo abierto",
        description=(
            "Lista las apps sin login y los límites aplicables: TTL del job, "
            "días de caché compartida, cuota de despacho, concurrencia y "
            "tamaño máximo de subida."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: Request) -> Response:
        del request
        apps: list[dict[str, object]] = []

        for route_key in PUBLIC_APP_ROUTE_KEYS:
            definition = ScientificAppRegistry.resolve_definition(route_key)
            if definition is None:
                continue
            apps.append(
                {
                    "route_key": definition.route_key,
                    "plugin_name": definition.plugin_name,
                    "api_base_path": definition.api_base_path,
                    "jobs_url": f"/api/public/{definition.route_key}/jobs/",
                }
            )

        return Response(
            {
                "mode": "open",
                "apps": apps,
                "limits": {
                    "job_ttl_hours": settings.ANONYMOUS_JOB_TTL_HOURS,
                    "shared_cache_days": settings.SHARED_CACHE_TTL_DAYS,
                    "dispatch_rate": settings.PUBLIC_DISPATCH_RATE,
                    "read_rate": settings.PUBLIC_READ_RATE,
                    "max_concurrent_jobs": settings.ANONYMOUS_MAX_CONCURRENT_JOBS,
                    "max_upload_bytes": settings.ANONYMOUS_MAX_UPLOAD_BYTES,
                },
            },
            status=status.HTTP_200_OK,
        )


public_router = DefaultRouter()
public_router.trailing_slash = "/?"

public_router.register(
    "public/molar-fractions/jobs",
    PublicMolarFractionsJobViewSet,
    basename="public-molar-fractions-job",
)
public_router.register(
    "public/tunnel/jobs",
    PublicTunnelJobViewSet,
    basename="public-tunnel-job",
)
public_router.register(
    "public/easy-rate/jobs",
    PublicEasyRateJobViewSet,
    basename="public-easy-rate-job",
)
public_router.register(
    "public/marcus/jobs",
    PublicMarcusJobViewSet,
    basename="public-marcus-job",
)
public_router.register(
    "public/smileit/jobs",
    PublicSmileitJobViewSet,
    basename="public-smileit-job",
)
public_router.register(
    "public/sa-score/jobs",
    PublicSaScoreJobViewSet,
    basename="public-sa-score-job",
)
public_router.register(
    "public/toxicity-properties/jobs",
    PublicToxicityPropertiesJobViewSet,
    basename="public-toxicity-properties-job",
)

public_urlpatterns = [
    path("public/catalog/", PublicCatalogView.as_view(), name="public-catalog"),
    *public_router.urls,
]

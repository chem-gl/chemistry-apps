"""public_urls.py: Rutas públicas (sin login) de las apps libres — fase 1.

Punto de composición que crea la variante pública de cada ViewSet científico.
Vive en `config/` para que `apps/core` no dependa de apps científicas.

Contrato:
- ``POST /api/public/<app>/jobs/`` crea un job anónimo y lo despacha.
- ``GET  /api/public/<app>/jobs/<uuid>/`` consulta el job por capability URL.
- ``GET  /api/public/<app>/jobs/<uuid>/report-csv/`` descarga resultados.

Ninguna otra acción queda expuesta (sin listados, sin logs, sin papelera).
"""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from apps.core.public_api import PublicAppViewSetMixin
from apps.easy_rate.routers import EasyRateJobViewSet
from apps.marcus.routers import MarcusJobViewSet
from apps.molar_fractions.routers import MolarFractionsJobViewSet
from apps.sa_score.routers import SaScoreJobViewSet
from apps.smileit.routers.viewset import SmileitJobViewSet
from apps.toxicity_properties.routers import ToxicityPropertiesJobViewSet
from apps.tunnel.routers import TunnelJobViewSet


class PublicMolarFractionsJobViewSet(
    PublicAppViewSetMixin, MolarFractionsJobViewSet
):
    """Versión sin login de Molar Fractions."""


class PublicTunnelJobViewSet(PublicAppViewSetMixin, TunnelJobViewSet):
    """Versión sin login de Tunnel Effect."""


class PublicEasyRateJobViewSet(PublicAppViewSetMixin, EasyRateJobViewSet):
    """Versión sin login de Easy-rate."""


class PublicMarcusJobViewSet(PublicAppViewSetMixin, MarcusJobViewSet):
    """Versión sin login de Marcus Theory."""


class PublicSmileitJobViewSet(PublicAppViewSetMixin, SmileitJobViewSet):
    """Versión sin login de Smileit."""


class PublicSaScoreJobViewSet(PublicAppViewSetMixin, SaScoreJobViewSet):
    """Versión sin login de SA Score."""


class PublicToxicityPropertiesJobViewSet(
    PublicAppViewSetMixin, ToxicityPropertiesJobViewSet
):
    """Versión sin login de Toxicity Properties."""


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

public_urlpatterns = public_router.urls

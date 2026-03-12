"""urls.py: Enrutamiento principal del backend y exposición de OpenAPI.

Objetivo del archivo:
- Consolidar las rutas HTTP del proyecto: admin, documentación OpenAPI y rutas
    DRF para jobs core y apps científicas.

Cómo se usa:
- Registrar aquí cualquier nuevo `ViewSet` de app científica usando el router.
- Mantener constantes de rutas en cada app (`definitions.py`) evita duplicación.
"""

from apps.calculator.definitions import APP_ROUTE_BASENAME, APP_ROUTE_PREFIX
from apps.calculator.routers import CalculatorJobViewSet
from apps.core.definitions import CORE_JOBS_ROUTE_BASENAME, CORE_JOBS_ROUTE_PREFIX
from apps.core.routers import JobViewSet
from apps.random_numbers.definitions import (
    APP_ROUTE_BASENAME as RANDOM_NUMBERS_ROUTE_BASENAME,
)
from apps.random_numbers.definitions import (
    APP_ROUTE_PREFIX as RANDOM_NUMBERS_ROUTE_PREFIX,
)
from apps.random_numbers.routers import RandomNumbersJobViewSet
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(CORE_JOBS_ROUTE_PREFIX, JobViewSet, basename=CORE_JOBS_ROUTE_BASENAME)
router.register(APP_ROUTE_PREFIX, CalculatorJobViewSet, basename=APP_ROUTE_BASENAME)
router.register(
    RANDOM_NUMBERS_ROUTE_PREFIX,
    RandomNumbersJobViewSet,
    basename=RANDOM_NUMBERS_ROUTE_BASENAME,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    # Endpoints de OpenAPI
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    # Endpoints de jobs del dominio core
    path("api/", include(router.urls)),
]

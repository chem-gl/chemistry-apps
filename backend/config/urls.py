"""urls.py: Enrutamiento principal del backend y exposición de OpenAPI."""

from apps.calculator.definitions import APP_ROUTE_BASENAME, APP_ROUTE_PREFIX
from apps.calculator.routers import CalculatorJobViewSet
from apps.core.definitions import CORE_JOBS_ROUTE_BASENAME, CORE_JOBS_ROUTE_PREFIX
from apps.core.routers import JobViewSet
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(CORE_JOBS_ROUTE_PREFIX, JobViewSet, basename=CORE_JOBS_ROUTE_BASENAME)
router.register(APP_ROUTE_PREFIX, CalculatorJobViewSet, basename=APP_ROUTE_BASENAME)

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

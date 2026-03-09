"""urls.py: Enrutamiento principal del backend y exposición de OpenAPI."""

from apps.calculator.routers import CalculatorJobViewSet
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
router.register(r"jobs", JobViewSet, basename="job")
router.register(r"calculator/jobs", CalculatorJobViewSet, basename="calculator-job")

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

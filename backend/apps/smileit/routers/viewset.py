"""routers_pkg/viewset.py: ViewSet de composición para Smile-it.

Compone mixins de lectura y escritura para exponer la API completa
manteniendo separación de responsabilidades por archivo.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.models import ScientificJob

from ..definitions import PLUGIN_NAME
from ..schemas import SmileitJobResponseSerializer
from .viewset_read import SmileitReadActionsMixin
from .viewset_write import SmileitWriteActionsMixin


@extend_schema(tags=["Smileit"])
class SmileitJobViewSet(
    SmileitReadActionsMixin,
    SmileitWriteActionsMixin,
    ScientificAppViewSetMixin,
    viewsets.ViewSet,
):
    """Endpoints de Smile-it con acciones separadas por mixins."""

    plugin_name = PLUGIN_NAME
    response_serializer_class = SmileitJobResponseSerializer
    csv_report_suffix = "structures"
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

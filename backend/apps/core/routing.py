"""routing.py: Enrutamiento WebSocket del dominio core.

Objetivo del archivo:
- Declarar las rutas ASGI de WebSocket para streaming de jobs científicos.

Cómo se usa:
- `config.asgi` importa `websocket_urlpatterns` y lo integra en `URLRouter`.
- Los clientes consumen eventos de progreso/logs conectando a
    `ws/jobs/stream/` con filtros opcionales por query params.

Nota de arquitectura:
- Mantener este archivo pequeño evita acoplar transporte ASGI con lógica de
    serialización o persistencia (resuelta en `consumers.py` y `realtime.py`).
"""

from django.urls import path

from .consumers import JobsStreamConsumer
from .definitions import CORE_JOBS_WEBSOCKET_ROUTE_PATH

websocket_urlpatterns = [
    # Ruta única de stream; el filtrado se maneja vía query params en el consumer.
    path(CORE_JOBS_WEBSOCKET_ROUTE_PATH, JobsStreamConsumer.as_asgi()),
]

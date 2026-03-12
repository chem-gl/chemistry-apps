"""routing.py: Enrutamiento WebSocket del dominio core."""

from django.urls import path

from .consumers import JobsStreamConsumer
from .definitions import CORE_JOBS_WEBSOCKET_ROUTE_PATH

websocket_urlpatterns = [
    path(CORE_JOBS_WEBSOCKET_ROUTE_PATH, JobsStreamConsumer.as_asgi()),
]

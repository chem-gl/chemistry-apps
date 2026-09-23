"""asgi.py: Configuración ASGI del proyecto para despliegues asíncronos.

Objetivo del archivo:
- Exponer la aplicación ASGI oficial del proyecto, combinando tráfico HTTP y
    WebSocket en una sola entrada.

Cómo se usa:
- Servidores ASGI (Daphne/Uvicorn) cargan `application` desde este módulo.
- `URLRouter(websocket_urlpatterns)` habilita stream realtime de jobs.
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Es crucial inicializar la aplicación Django ANTES de importar cualquier
# módulo que pueda acceder al ORM o a la configuración de la app.
django_asgi_app = get_asgi_application()


def _get_websocket_urlpatterns():
    # Import tardío para preservar el orden de inicialización de Django/ORM.
    from apps.core.consumers import websocket_urlpatterns

    return websocket_urlpatterns


def _get_websocket_application():
    # `AuthMiddlewareStack` resuelve primero la sesión por cookies; el middleware
    # JWT lo sobrescribe cuando el cliente envía `?token=<access>` (navegadores
    # no pueden mandar cabeceras en una conexión WebSocket).
    from apps.core.identity.ws_auth import JWTAuthMiddleware

    return AuthMiddlewareStack(
        JWTAuthMiddleware(URLRouter(_get_websocket_urlpatterns()))
    )


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": _get_websocket_application(),
    }
)

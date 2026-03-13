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

from apps.core.routing import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)

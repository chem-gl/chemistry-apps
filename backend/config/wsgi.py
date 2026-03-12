"""wsgi.py: Configuración WSGI del proyecto para servidores HTTP síncronos.

Objetivo del archivo:
- Exponer la aplicación WSGI estándar para despliegues tradicionales
        (por ejemplo, Gunicorn en modo sync o servidores compatibles WSGI).

Cómo se usa:
- El servidor de aplicaciones importa `application` desde este módulo.
- Para WebSockets, usar despliegue ASGI (`config.asgi`) en lugar de WSGI.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()

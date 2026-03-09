"""celery.py: Configuración central de Celery para tareas asíncronas."""

import os

from celery import Celery

# Define el módulo de settings por defecto para Celery.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("config")

# Usar cadena evita serializar el objeto de configuración a procesos hijos.
# namespace='CELERY' indica que las claves deben usar prefijo `CELERY_`.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Carga tareas desde todas las apps registradas.
app.autodiscover_tasks()

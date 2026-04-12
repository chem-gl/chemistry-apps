"""Configuración mínima de pytest para la base de código de Django.

@Author: Cesar Guzman

Este archivo se ejecuta automáticamente por pytest antes de cualquier test.
Asegura que Django esté configurado correctamente para poder importar y usar
componentes que dependen de `django.conf.settings`.


Se mantiene deliberadamente simple para evitar *sobre-configuración* y no
requiere dependencias adicionales como `pytest-django`.
Solo tiene la responsabilidad de configurar los test para que no necesiten
base de datos  y redis reales, lo que permite ejecutar tests de forma rápida y aislada sin necesidad
de servicios externos se necesita para github actions.

"""

import os

# Este módulo se carga al iniciar pytest. Debe configurarse antes de usar
# cualquier funcionalidad de Django que acceda a settings (p.ej. django.db).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Forzar capa de canales en memoria para tests que no necesitan Redis real.
# Evita ConnectionError en tests que publican logs de job via channel_layer.
os.environ.setdefault("USE_INMEMORY_CHANNEL_LAYER", "true")

# Importar y configurar Django solo una vez. Si ya se configuró, `django.setup`
# no hace nada.
import django

django.setup()

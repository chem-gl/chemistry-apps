"""Configuración mínima de pytest para la base de código de Django.

Este archivo se ejecuta automáticamente por pytest antes de cualquier test.
Asegura que Django esté configurado correctamente para poder importar y usar
componentes que dependen de `django.conf.settings`.

Se mantiene deliberadamente simple para evitar *sobre-configuración* y no
requiere dependencias adicionales como `pytest-django`.
"""

import os

# Este módulo se carga al iniciar pytest. Debe configurarse antes de usar
# cualquier funcionalidad de Django que acceda a settings (p.ej. django.db).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Importar y configurar Django solo una vez. Si ya se configuró, `django.setup`
# no hace nada.
import django

django.setup()

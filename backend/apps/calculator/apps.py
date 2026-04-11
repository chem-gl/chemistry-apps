"""apps.py: Configuración Django de la app calculadora modular.

Este módulo formaliza la integración de calculator con `apps.core` durante el
arranque de Django.

Objetivo principal:
- Registrar metadatos de la app para validación de colisiones de rutas/plugin.
- Asegurar que el plugin de cálculo quede disponible antes de recibir tráfico.
"""

from django.apps import AppConfig

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)


class CalculatorConfig(AppConfig):
    """Configura y registra el plugin calculadora durante el arranque.

    Cualquier app científica nueva debería replicar este patrón:
    1. Crear su definición de app (ruta base, prefix, plugin, basename).
    2. Registrarla con `ScientificAppRegistry`.
    3. Importar su módulo de plugin en `ready()` para activar el decorator de
       `PluginRegistry.register(...)`.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Registra metadatos y publica el plugin en el registry global.

        Esta ejecución ocurre una vez por proceso de Django. Si hay duplicados
        de configuración, el arranque falla temprano para proteger el contrato
        de enrutamiento y la resolución de plugins.
        """
        app_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name=self.name,
            plugin_name=PLUGIN_NAME,
            api_route_prefix=APP_ROUTE_PREFIX,
            api_base_path=APP_API_BASE_PATH,
            route_basename=APP_ROUTE_BASENAME,
            supports_pause_resume=False,
        )
        ScientificAppRegistry.register(app_definition)

        from . import plugin  # noqa: F401

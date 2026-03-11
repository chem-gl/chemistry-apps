"""processing.py: Registro y ejecución de plugins científicos desacoplados.

Este módulo actúa como puente entre la capa de servicios (`JobService`) y la
función de dominio que implementa cada app científica.

Uso esperado desde una app:
1. Definir una función pura de plugin que reciba `JSONMap` y retorne `JSONMap`.
2. Decorar la función con `@PluginRegistry.register("nombre-plugin")`.
3. Evitar lógica HTTP o acceso directo a request dentro del plugin.
4. Dejar validaciones de contrato de entrada en serializers y validaciones
    locales en el propio plugin para robustez de ejecución asíncrona.
"""

from collections.abc import Callable

from django.core.exceptions import ImproperlyConfigured

from .types import JSONMap

PluginCallable = Callable[[JSONMap], JSONMap]


class PluginRegistry:
    """Registry para aislar plugins científicos de la capa HTTP.

    Este registro es intencionalmente simple: mapea un nombre de plugin a una
    callable. De este modo, `core` puede ejecutar cualquier app científica sin
    conocer su implementación interna.
    """

    _plugins: dict[str, PluginCallable] = {}
    _plugin_sources: dict[str, str] = {}

    @classmethod
    def register(cls, name: str) -> Callable[[PluginCallable], PluginCallable]:
        """Registra una función de plugin bajo un nombre único.

        Si dos funciones distintas intentan registrar el mismo nombre, se lanza
        `ImproperlyConfigured` para evitar comportamiento ambiguo durante la
        ejecución de jobs.
        """

        def wrapper(func: PluginCallable) -> PluginCallable:
            plugin_source_name: str = f"{func.__module__}.{func.__qualname__}"
            existing_source_name: str | None = cls._plugin_sources.get(name)

            if (
                existing_source_name is not None
                and existing_source_name != plugin_source_name
            ):
                raise ImproperlyConfigured(
                    f"Plugin name duplicated: '{name}' from '{plugin_source_name}' "
                    f"already registered by '{existing_source_name}'."
                )

            cls._plugins[name] = func
            cls._plugin_sources[name] = plugin_source_name
            return func

        return wrapper

    @classmethod
    def execute(cls, name: str, parameters: JSONMap) -> JSONMap:
        """Ejecuta la lógica de plugin registrada con parámetros tipados.

        Este método es invocado por la capa de servicios. Si el plugin no está
        registrado, se lanza `ValueError` para que el flujo marque el job como
        fallido con trazabilidad en `error_trace`.
        """
        if name not in cls._plugins:
            raise ValueError(f"Plugin {name} has not been registered in PluginRegistry")

        return cls._plugins[name](parameters)

"""processing.py: Registro y ejecucion de plugins cientificos desacoplados."""

from collections.abc import Callable

from django.core.exceptions import ImproperlyConfigured

from .types import JSONMap

PluginCallable = Callable[[JSONMap], JSONMap]


class PluginRegistry:
    """Registry para aislar plugins cientificos de la capa HTTP."""

    _plugins: dict[str, PluginCallable] = {}
    _plugin_sources: dict[str, str] = {}

    @classmethod
    def register(cls, name: str) -> Callable[[PluginCallable], PluginCallable]:
        """Registra una funcion de plugin bajo un nombre unico."""

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
        """Ejecuta la logica de plugin registrada con parametros tipados."""
        if name not in cls._plugins:
            raise ValueError(f"Plugin {name} has not been registered in PluginRegistry")

        return cls._plugins[name](parameters)

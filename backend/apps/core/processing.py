"""processing.py: Registro y ejecucion de plugins cientificos desacoplados."""

from collections.abc import Callable

from .types import JSONMap

PluginCallable = Callable[[JSONMap], JSONMap]


class PluginRegistry:
    """Registry para aislar plugins cientificos de la capa HTTP."""

    _plugins: dict[str, PluginCallable] = {}

    @classmethod
    def register(cls, name: str) -> Callable[[PluginCallable], PluginCallable]:
        """Registra una funcion de plugin bajo un nombre unico."""

        def wrapper(func: PluginCallable) -> PluginCallable:
            cls._plugins[name] = func
            return func

        return wrapper

    @classmethod
    def execute(cls, name: str, parameters: JSONMap) -> JSONMap:
        """Ejecuta la logica de plugin registrada con parametros tipados."""
        if name not in cls._plugins:
            raise ValueError(f"Plugin {name} has not been registered in PluginRegistry")

        return cls._plugins[name](parameters)

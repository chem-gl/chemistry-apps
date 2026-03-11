"""factory.py: Factoría para componer servicios core con puertos y adaptadores.

Este módulo concentra la composición de dependencias del dominio `core`.
La intención es que routers, tasks y otras capas usen una sola entrada de
construcción (`build_job_service`) en lugar de instanciar adaptadores sueltos.

Ventajas para apps consumidoras de core:
- Menor acoplamiento a infraestructura.
- Punto único para cambiar implementaciones de puertos.
- Consistencia entre ejecución HTTP y ejecución Celery.
"""

from __future__ import annotations

from functools import lru_cache

from .adapters import (
    DjangoCacheRepositoryAdapter,
    DjangoJobProgressPublisherAdapter,
    DjangoPluginExecutionAdapter,
)
from .services import RuntimeJobService


@lru_cache(maxsize=1)
def build_job_service() -> RuntimeJobService:
    """Construye una instancia singleton del servicio de jobs para runtime.

    En producción devuelve una instancia cacheada por proceso. Para pruebas
    unitarias avanzadas, se recomienda testear `RuntimeJobService` con dobles
    de prueba en lugar de depender de esta factoría.
    """
    return RuntimeJobService(
        cache_repository=DjangoCacheRepositoryAdapter(),
        plugin_execution=DjangoPluginExecutionAdapter(),
        progress_publisher=DjangoJobProgressPublisherAdapter(),
    )

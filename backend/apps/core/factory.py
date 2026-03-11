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
    DjangoJobLogPublisherAdapter,
    DjangoJobProgressPublisherAdapter,
    DjangoPluginExecutionAdapter,
)
from .ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobProgressPublisherPort,
    PluginExecutionPort,
)
from .services import RuntimeJobService


def build_job_service_with_ports(
    *,
    cache_repository: CacheRepositoryPort,
    plugin_execution: PluginExecutionPort,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> RuntimeJobService:
    """Compone RuntimeJobService con puertos explícitos para integraciones externas.

    Esta función permite reutilizar el núcleo desde otros puntos del programa
    (funciones, extensiones u orquestadores) sin acoplarse a adaptadores Django.
    """
    return RuntimeJobService(
        cache_repository=cache_repository,
        plugin_execution=plugin_execution,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    )


@lru_cache(maxsize=1)
def build_job_service() -> RuntimeJobService:
    """Construye una instancia singleton del servicio de jobs para runtime.

    En producción devuelve una instancia cacheada por proceso. Para pruebas
    unitarias avanzadas, se recomienda testear `RuntimeJobService` con dobles
    de prueba en lugar de depender de esta factoría.
    """
    return build_job_service_with_ports(
        cache_repository=DjangoCacheRepositoryAdapter(),
        plugin_execution=DjangoPluginExecutionAdapter(),
        progress_publisher=DjangoJobProgressPublisherAdapter(),
        log_publisher=DjangoJobLogPublisherAdapter(),
    )

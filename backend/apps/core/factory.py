"""factory.py: Factoría para componer servicios core con puertos y adaptadores."""

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
    """Construye una instancia singleton del servicio de jobs para runtime."""
    return RuntimeJobService(
        cache_repository=DjangoCacheRepositoryAdapter(),
        plugin_execution=DjangoPluginExecutionAdapter(),
        progress_publisher=DjangoJobProgressPublisherAdapter(),
    )

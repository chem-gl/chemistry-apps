"""routers/__init__.py: Re-exporta símbolos públicos del paquete routers.

Mantiene compatibilidad con `from apps.core.routers import JobViewSet`
y con `mock.patch('apps.core.routers.dispatch_scientific_job')`.
"""

from .helpers import ServerSentEventsRenderer
from .viewset import JobViewSet, dispatch_scientific_job

__all__ = [
    "JobViewSet",
    "ServerSentEventsRenderer",
    "dispatch_scientific_job",
]

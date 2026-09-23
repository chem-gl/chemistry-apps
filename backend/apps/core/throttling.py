"""throttling.py: Clases de límite de tasa para el API científico.

Fase 1 (apps libres) diferencia dos perfiles:

- Anónimo: se identifica por IP y tiene un tope estricto de despachos.
- Registrado: se identifica por usuario y mantiene los topes holgados actuales.

Las tasas se leen de ``settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`` en
cada instancia (no al importar), de modo que ``override_settings`` y los cambios
por entorno se apliquen de verdad.

Referencia: https://www.django-rest-framework.org/api-guide/throttling/
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class SettingsDrivenRateMixin:
    """Resuelve la tasa del scope desde Django settings en cada instancia."""

    scope: str | None = None

    def get_rate(self) -> str:
        """Retorna la tasa configurada para el scope, con fallback a DRF."""
        configured_rates = getattr(settings, "REST_FRAMEWORK", {}).get(
            "DEFAULT_THROTTLE_RATES", {}
        )
        configured_rate = configured_rates.get(self.scope or "")

        if configured_rate:
            return str(configured_rate)

        return super().get_rate()  # type: ignore[misc]


class AnonymousDispatchRateThrottle(SettingsDrivenRateMixin, AnonRateThrottle):
    """Limita despachos anónimos por IP según el scope ``public-dispatch``."""

    scope = "public-dispatch"


class RegisteredDispatchRateThrottle(SettingsDrivenRateMixin, UserRateThrottle):
    """Limita despachos de usuarios autenticados según ``registered-dispatch``."""

    scope = "registered-dispatch"


class AnonymousReadRateThrottle(SettingsDrivenRateMixin, AnonRateThrottle):
    """Limita lecturas anónimas costosas según el scope ``public-read``.

    Aplica a lo que sí consume CPU en el servidor: descarga de reportes,
    derivaciones paginadas, SVG por estructura y ZIPs de imágenes. El polling
    del estado (``retrieve``) queda fuera para no castigar el modo libre.
    """

    scope = "public-read"


class RegistrationRateThrottle(SettingsDrivenRateMixin, AnonRateThrottle):
    """Frena la creación masiva de cuentas (spam/DoS de DB) por IP."""

    scope = "registration"

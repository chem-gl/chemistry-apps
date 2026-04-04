"""services/config.py: Lectura de configuración para el servicio de jobs.

Encapsula el acceso a settings de Django para límites de caché,
reintentos de recuperación y parámetros configurables por plugin.
"""

from __future__ import annotations

from django.conf import settings


def get_max_recovery_attempts() -> int:
    """Obtiene número máximo de reintentos de recuperación por job."""
    configured_max_attempts: int = int(
        getattr(settings, "JOB_RECOVERY_MAX_ATTEMPTS", 5)
    )
    return max(1, configured_max_attempts)


def get_result_cache_payload_limit_bytes(plugin_name: str) -> int:
    """Retorna límite de caché para un plugin con fallback al valor global."""
    global_limit: int = int(
        getattr(settings, "JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES", 8 * 1024 * 1024)
    )

    per_plugin_limits_raw: object = getattr(
        settings,
        "JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES_BY_PLUGIN",
        {},
    )
    if isinstance(per_plugin_limits_raw, dict):
        plugin_limit_value: object | None = per_plugin_limits_raw.get(plugin_name)
        if isinstance(plugin_limit_value, int):
            return max(1024, plugin_limit_value)
        if isinstance(plugin_limit_value, str):
            try:
                parsed_plugin_limit: int = int(plugin_limit_value)
            except ValueError:
                parsed_plugin_limit = global_limit
            return max(1024, parsed_plugin_limit)

    return max(1024, global_limit)

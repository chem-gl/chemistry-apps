"""concurrency.py: Semáforo distribuido por cliente para el modo libre.

Objetivo del archivo:
- Limitar cuántos trabajos anónimos puede tener **en vuelo** un mismo cliente
  (por defecto 2), que es distinto de limitar la tasa de peticiones.

Diseño (recomendaciones del informe `research/apps-libres-standards`):
- Un *sorted set* por cliente: ``apps-libres:concurrency:v1:{ip_hash}`` con
  ``score = vencimiento`` y miembro = token del lease.
- Adquisición y liberación con **scripts Lua** para que la comprobación y la
  inserción sean atómicas (evita el TOCTOU de ``ZCARD`` + ``ZADD`` separados).
- El lease se guarda en ``ScientificJob.runtime_state`` y se libera cuando el
  job termina (señales de Celery). El **TTL es la red de seguridad** si el
  worker muere sin ejecutar ninguna callback.
- Si Redis no responde se falla **abierto** (se registra el aviso) para no
  tumbar la aplicación por un problema de infraestructura: el control es
  anti-abuso, no un mecanismo de seguridad de acceso.

Uso:
    lease = acquire_slot(request)
    if lease is None: ...429...
    attach_lease_to_job(job, lease)   # se libera al terminar el job
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from django.conf import settings
from django.utils import timezone
from redis import Redis
from redis.exceptions import RedisError

from .models import ScientificJob

logger = logging.getLogger(__name__)

KEY_NAMESPACE = "apps-libres:concurrency:v1"
DEFAULT_MAX_CONCURRENT_JOBS = 2
DEFAULT_LEASE_SECONDS = 1800
RUNTIME_STATE_LEASE_KEY = "concurrency_lease"

# Estados en los que el job ya no se ejecutará: nadie liberará su lease.
TERMINAL_JOB_STATUSES: frozenset[str] = frozenset(
    {"completed", "failed", "cancelled"}
)

CONCURRENCY_LIMIT_DETAIL: str = (
    "Tienes demasiados cálculos en curso. Espera a que terminen e inténtalo de nuevo."
)

# ZREMRANGEBYSCORE limpia leases vencidos, ZCARD comprueba el cupo y ZADD
# registra el lease: todo atómico dentro del script.
_ACQUIRE_SCRIPT = """
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local deadline_ms = tonumber(ARGV[2])
local max_slots = tonumber(ARGV[3])
local token = ARGV[4]
local ttl_ms = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)
local active = redis.call('ZCARD', key)
if active >= max_slots then
  return 0
end
redis.call('ZADD', key, deadline_ms, token)
redis.call('PEXPIRE', key, ttl_ms)
return 1
"""

# ZREM solo elimina el token propio: liberar dos veces es idempotente y nunca
# borra el lease de otro trabajo.
_RELEASE_SCRIPT = """
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return 1
"""

_redis_client: Redis | None = None


@dataclass(frozen=True, slots=True)
class ConcurrencyLease:
    """Lease de concurrencia. Un lease con ``key`` vacía significa "sin control"."""

    key: str
    token: str

    @property
    def is_noop(self) -> bool:
        """Indica que el lease no se registró (Redis no disponible)."""
        return self.key == "" or self.token == ""


def get_redis_client() -> Redis:
    """Retorna el cliente Redis compartido (web y workers) para el semáforo."""
    global _redis_client

    if _redis_client is None:
        redis_url: str = str(
            getattr(settings, "CONCURRENCY_REDIS_URL", "")
            or getattr(settings, "CHANNEL_LAYERS_REDIS_URL", "")
            or "redis://localhost:6379/0"
        )
        _redis_client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )

    return _redis_client


def resolve_max_concurrent_jobs() -> int:
    """Cupo de trabajos simultáneos por cliente (mínimo 1)."""
    configured_value = int(
        getattr(settings, "ANONYMOUS_MAX_CONCURRENT_JOBS", DEFAULT_MAX_CONCURRENT_JOBS)
    )
    return max(1, configured_value)


def resolve_lease_seconds() -> int:
    """Vida máxima del lease en segundos (mínimo 60)."""
    configured_value = int(
        getattr(settings, "ANONYMOUS_CONCURRENCY_LEASE_SECONDS", DEFAULT_LEASE_SECONDS)
    )
    return max(60, configured_value)


def build_lease_key(request: object) -> str:
    """Construye la clave del semáforo hasheando el identificador del cliente.

    Usa el mismo criterio de identificación que DRF (`REMOTE_ADDR` o
    `X-Forwarded-For` según ``NUM_PROXIES``) y guarda solo el hash: la IP no se
    persiste en claro en Redis.
    """
    from rest_framework.throttling import BaseThrottle

    client_identifier = str(BaseThrottle().get_ident(request))
    identifier_hash = hashlib.sha256(client_identifier.encode("utf-8")).hexdigest()
    return f"{KEY_NAMESPACE}:{identifier_hash[:32]}"


def acquire_slot(
    request: object,
    *,
    client: Redis | None = None,
) -> ConcurrencyLease | None:
    """Intenta reservar un cupo de concurrencia para el cliente de la petición.

    Retorna el lease reservado, ``None`` si el cliente ya agotó su cupo, o un
    lease *no-op* si Redis no está disponible (fallo abierto, con aviso).
    """
    lease_key = build_lease_key(request)
    token = hashlib.sha256(f"{lease_key}:{timezone.now().timestamp()}".encode()).hexdigest()
    max_slots = resolve_max_concurrent_jobs()
    lease_seconds = resolve_lease_seconds()
    now_ms = int(timezone.now().timestamp() * 1000)

    try:
        redis_client = client or get_redis_client()
        acquired = redis_client.eval(
            _ACQUIRE_SCRIPT,
            1,
            lease_key,
            now_ms,
            now_ms + lease_seconds * 1000,
            max_slots,
            token,
            lease_seconds * 2 * 1000,
        )
    except RedisError:
        logger.warning(
            "Redis no disponible para el semáforo de concurrencia; se permite el job.",
            exc_info=True,
        )
        return ConcurrencyLease(key="", token="")

    if int(acquired) != 1:
        return None

    return ConcurrencyLease(key=lease_key, token=token)


def release_lease(lease: ConcurrencyLease, *, client: Redis | None = None) -> None:
    """Libera el lease. Idempotente y silencioso si Redis no está disponible."""
    if lease.is_noop:
        return

    try:
        redis_client = client or get_redis_client()
        redis_client.eval(_RELEASE_SCRIPT, 1, lease.key, lease.token)
    except RedisError:
        logger.warning(
            "No se pudo liberar el lease de concurrencia %s; el TTL lo recuperará.",
            lease.key,
            exc_info=True,
        )


def attach_lease_to_job(job: ScientificJob, lease: ConcurrencyLease) -> None:
    """Persiste el lease en ``runtime_state`` para liberarlo al terminar el job.

    Si el job ya está en estado terminal (p. ej. terminó entre el despacho y este
    momento) el lease se libera al instante: ningún worker lo liberaría después.
    """
    if lease.is_noop:
        return

    job.refresh_from_db(fields=["status", "runtime_state"])
    if job.status in TERMINAL_JOB_STATUSES:
        release_lease(lease)
        return

    runtime_state: dict[str, object] = dict(job.runtime_state or {})
    runtime_state[RUNTIME_STATE_LEASE_KEY] = {"key": lease.key, "token": lease.token}
    job.runtime_state = runtime_state
    job.save(update_fields=["runtime_state", "updated_at"])


def release_job_lease(
    job: ScientificJob,
    *,
    client: Redis | None = None,
    persist: bool = True,
) -> None:
    """Libera el lease asociado al job (si lo tiene).

    ``persist=False`` evita escribir en el job cuando está a punto de borrarse
    (por ejemplo durante la purga de jobs anónimos vencidos).
    """
    runtime_state: dict[str, object] = dict(job.runtime_state or {})
    lease_payload = runtime_state.pop(RUNTIME_STATE_LEASE_KEY, None)
    if not isinstance(lease_payload, dict):
        return

    lease_key = str(lease_payload.get("key", ""))
    lease_token = str(lease_payload.get("token", ""))
    release_lease(ConcurrencyLease(key=lease_key, token=lease_token), client=client)

    if not persist:
        return

    job.runtime_state = runtime_state
    job.save(update_fields=["runtime_state", "updated_at"])

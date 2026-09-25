"""concurrency_lease.py: Preservación del lease entre escrituras de `runtime_state`.

El cupo de concurrencia vive en `job.runtime_state["concurrency_lease"]` desde
que se adjunta en el despacho hasta que la señal `task_postrun` lo libera. Si
algún servicio sobrescribe `runtime_state` en el camino (fin terminal,
checkpoint de pausa), debe conservar esa clave o el cupo queda huérfano en
Redis hasta el TTL.

La lectura del lease vigente se hace **fresca desde la BD** porque el worker
carga el job antes de que el proceso HTTP lo adjunte: confiar en el objeto en
memoria borra el lease recién escrito y produce 429 fantasma (cupo ocupado con
0 jobs en curso).
"""

from __future__ import annotations

import logging
from typing import cast

from ..concurrency import RUNTIME_STATE_LEASE_KEY
from ..models import ScientificJob
from ..types import JSONMap

logger = logging.getLogger(__name__)


def preserve_concurrency_lease(
    current_state: JSONMap | None, next_state: JSONMap
) -> JSONMap:
    """Devuelve `next_state` conservando el lease de `current_state` si existe."""
    merged_state: JSONMap = dict(next_state)
    current_lease = (current_state or {}).get(RUNTIME_STATE_LEASE_KEY)

    if isinstance(current_lease, dict):
        merged_state[RUNTIME_STATE_LEASE_KEY] = current_lease

    return merged_state


def _extract_lease(runtime_state: JSONMap | None) -> JSONMap | None:
    """Extrae el payload del lease de un `runtime_state` cualquiera."""
    lease_payload = (runtime_state or {}).get(RUNTIME_STATE_LEASE_KEY)
    if isinstance(lease_payload, dict):
        return cast(JSONMap, lease_payload)
    return None


def read_current_concurrency_lease(job: ScientificJob) -> JSONMap | None:
    """Retorna el lease vigente del job, refrescando `runtime_state` desde la BD.

    El objeto en memoria del worker puede ser anterior al `attach_lease_to_job`
    que hizo el proceso HTTP; sin la lectura fresca se escribiría un
    `runtime_state` obsoleto y el lease quedaría huérfano. Si la refrescada
    falla (job ya borrado, instancia sin pk) se usa el valor en memoria.
    """
    in_memory_lease = _extract_lease(job.runtime_state)

    try:
        job.refresh_from_db(fields=["runtime_state"])
    except Exception:  # noqa: BLE001 - sin lectura fresca se conserva el valor local
        logger.debug(
            "No se pudo refrescar runtime_state del job %s; se usa el valor local.",
            getattr(job, "pk", None),
            exc_info=True,
        )
        return in_memory_lease

    return _extract_lease(job.runtime_state) or in_memory_lease


def merge_concurrency_lease(job: ScientificJob, next_state: JSONMap) -> JSONMap:
    """Devuelve `next_state` con el lease vigente del job, leído fresco de la BD."""
    current_lease = read_current_concurrency_lease(job)
    fresh_state: JSONMap = {}
    if current_lease is not None:
        fresh_state[RUNTIME_STATE_LEASE_KEY] = current_lease

    return preserve_concurrency_lease(fresh_state, next_state)

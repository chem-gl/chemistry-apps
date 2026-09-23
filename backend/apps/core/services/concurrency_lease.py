"""concurrency_lease.py: Preservación del lease entre escrituras de `runtime_state`.

El cupo de concurrencia vive en `job.runtime_state["concurrency_lease"]` desde
que se adjunta en el despacho hasta que la señal `task_postrun` lo libera. Si
algún servicio sobrescribe `runtime_state` en el camino (fin terminal,
checkpoint de pausa), debe conservar esa clave o el cupo queda huérfano en
Redis hasta el TTL.
"""

from __future__ import annotations

from ..concurrency import RUNTIME_STATE_LEASE_KEY
from ..types import JSONMap


def preserve_concurrency_lease(
    current_state: JSONMap | None, next_state: JSONMap
) -> JSONMap:
    """Devuelve `next_state` conservando el lease de `current_state` si existe."""
    merged_state: JSONMap = dict(next_state)
    current_lease = (current_state or {}).get(RUNTIME_STATE_LEASE_KEY)

    if isinstance(current_lease, dict):
        merged_state[RUNTIME_STATE_LEASE_KEY] = current_lease

    return merged_state

"""cache.py: Utilidades de fingerprint reproducible para cache de jobs.

Objetivo del archivo:
- Definir cómo se construye la identidad determinista de un job científico.

Cómo se usa:
- `services.py` llama `generate_job_hash(...)` antes de crear o ejecutar jobs.
- El hash resultante permite detectar resultados ya calculados en
    `ScientificCacheEntry` y evitar recomputar cargas costosas.

Regla importante:
- Dos requests semánticamente iguales deben producir exactamente el mismo hash,
    aun cuando el orden de claves en `parameters` cambie.
"""

import hashlib
import json

from .types import JSONMap


def generate_job_hash(
    plugin_name: str,
    version: str,
    parameters: JSONMap,
    input_file_signatures: list[str] | None = None,
) -> str:
    """Genera hash SHA-256 estable del job para habilitar cache determinista."""
    # Se normaliza el payload completo para asegurar invariancia por orden.
    normalized_payload: JSONMap = {
        "plugin_name": plugin_name,
        "version": version,
        "parameters": parameters,
        "input_file_signatures": sorted(input_file_signatures or []),
    }
    # `sort_keys=True` garantiza serialización canónica del JSON.
    payload_serialized: str = json.dumps(
        normalized_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    raw_string = payload_serialized
    # El hash final es la llave de cache compartida por toda la plataforma.
    return hashlib.sha256(raw_string.encode("utf-8")).hexdigest()

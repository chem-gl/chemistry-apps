"""cache.py: Utilidades de fingerprint reproducible para cache de jobs."""

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
    normalized_payload: JSONMap = {
        "plugin_name": plugin_name,
        "version": version,
        "parameters": parameters,
        "input_file_signatures": sorted(input_file_signatures or []),
    }
    payload_serialized: str = json.dumps(
        normalized_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    raw_string = payload_serialized
    return hashlib.sha256(raw_string.encode("utf-8")).hexdigest()

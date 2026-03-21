"""cache_policy_general.py: Política general de caché para resultados de jobs.

Objetivo del archivo:
- Centralizar los defaults globales de tamaño para persistencia de resultados
  en caché, de forma que todos los plugins compartan una base consistente.

Cómo se usa:
- `config/settings.py` importa estas constantes para construir la configuración
  final, permitiendo override por variables de entorno.
"""

GENERAL_RESULT_CACHE_MIN_PAYLOAD_BYTES: int = 1024
GENERAL_RESULT_CACHE_MAX_PAYLOAD_BYTES_DEFAULT: int = 8 * 1024 * 1024

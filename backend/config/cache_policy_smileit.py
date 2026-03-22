"""cache_policy_smileit.py: Política específica de caché para Smile-it.

Objetivo del archivo:
- Definir un límite de caché diferenciado para Smile-it, ya que su payload puede
  crecer mucho por estructura generada y SVGs embebidos.

Cómo se usa:
- `config/settings.py` usa esta constante para poblar la tabla de límites por
  plugin y permitir override mediante variable de entorno dedicada.
"""

SMILEIT_RESULT_CACHE_MAX_PAYLOAD_BYTES_DEFAULT: int = 2 * 1024 * 1024

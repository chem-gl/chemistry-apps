"""__init__.py: Paquete de la app de generación de números aleatorios.

Objetivo del paquete:
- Ofrecer una app científica completa con soporte de ejecución por lotes,
  progreso incremental y pausa/reanudación con checkpoint.

Flujo recomendado de uso:
1. `apps.py` registra metadatos en `ScientificAppRegistry`.
2. `plugin.py` publica la función en `PluginRegistry`.
3. `routers.py` valida request y delega en `DeclarativeJobAPI`.
4. `schemas.py` y `types.py` mantienen contrato estricto para API y runtime.
"""

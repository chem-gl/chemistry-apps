"""__init__.py: Paquete de la app plantilla de calculadora científica.

Esta app funciona como implementación de referencia para cualquier app
científica que quiera integrarse con `apps.core`.

Flujo recomendado de uso con paquetes de core:
1. `apps.py` registra metadatos en `ScientificAppRegistry`.
2. `plugin.py` publica el algoritmo con `PluginRegistry`.
3. `routers.py` crea jobs con `JobService` y solicita encolado con
        `dispatch_scientific_job`.
4. El estado/progreso/resultados se consulta desde endpoints core o desde el
        endpoint dedicado de calculator.
"""

"""__init__.py: Punto de entrada del paquete core y guía de integración.

Este paquete define la infraestructura compartida para todas las apps científicas
del backend (registro de apps, ejecución de plugins, ciclo de vida de jobs,
persistencia de cache y progreso por eventos).

Uso recomendado desde una app científica nueva:
1. Definir constantes de app (prefijos de ruta, plugin, basename) en su módulo
        `definitions.py`.
2. Registrar metadatos en `AppConfig.ready()` usando `ScientificAppRegistry`.
3. Registrar la función de cómputo con `@PluginRegistry.register(...)`.
4. Exponer endpoints HTTP por app que deleguen en `JobService` para crear jobs
        y en `dispatch_scientific_job` para encolado asíncrono.
5. Reutilizar endpoints core (`/api/jobs/`, `/progress/`, `/events/`) para
        observabilidad y trazabilidad operativa.
"""

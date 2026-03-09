# Plataforma Científica Modular

Plataforma por plugins basada en Django (backend) y Angular (frontend) diseñada para aplicaciones científicas modulares. La plataforma permite la ejecución asíncrona de jobs científicos pesados, incorpora un sistema de caché basado en hashes, y se adhiere rígidamente a contratos definidos mediante OpenAPI-first, los cuales son consumidos automáticamente por rutinas del frontend.

## Arquitectura por Plugins

Esta plataforma está diseñada de forma modular, permitiendo extenderla creando "plugins" (aplicaciones de Django / módulos Lazy de Angular). Cada app científica (ej. simulación cuántica, procesamiento químico) es un módulo independiente que interactúa con un "core" base que provee los servicios de enrutamiento, base de datos, encolamiento y despacho en segundo plano de jobs.

**Aislamiento y desacoplo (Regla Routers -> Services):**

- **Controladores (Routers):** Los Endpoints de la API son estúpidos, su única función es mapear reques/responses y delegar validaciones simples.
- **Servicios:** La lógica de negocio real residirá independientemente en servicios aislados de la capa HTTP. Esto facilita el código que no dependa puramente de un Request asincrono, para que se pueda llamar a través de scripts de batch o APIs RPC si fuese necesario.

## Ciclo de Vida de los Jobs Científicos (ScientificJob)

1. **Pending**: Un Job es creado mediante un endpoint HTTP con los parámetros de la simulación pero en espera a ser despachado.
2. **Running**: El Job ha sido recogido por un worker (Celery) que se encarga del cómputo científico en el fondo.
3. **Completed**: El cálculo finaliza exitosamente; genera `outputs` u artefactos persistentes listos para ser consumidos y actualiza el estado.
4. **Failed**: Captura e interrumpe simulaciones erróneas, persistiendo la traza de stack o error particular del framework científico empaquetado.

## Diseño del Cache

Con el costo computacional de las operaciones científicas, los jobs emplean caché exhaustivo:

- **Fingerprinting (Hash) Repetible:** Antes de ejecutar o incluso encolar un proceso complejo, el input combinado (archivos e insumos físicos de simulación), los parámetros, sumados a la versión particular del algoritmo subyacente formulan un hash de Job de entrada combinada.
- Si este hash tiene correspondencia con operaciones concluidas (Caché Hit), el Job se marca automáticamente como completado y se referencian los mismos resultantes en milésimas de segundo en lugar de incurrir de nuevo en simulaciones extenuantes.
- En caso opuesto (Caché Miss), la ejecución se acopla según el flujo regular.

> [!NOTE]
> Nota de entorno: El usuario puede ejecutar el código en una máquina local o en un servidor, y se pueden emplear diferentes IDEs o editores de código (como VS Code) sin complicaciones, dado que no depende de interfaces integradas localmente, solo los brokers (Redis) y entornos de virtualización nativa.

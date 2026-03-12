---
applyTo: "backend/apps/**/*.py"
---

# Manual de Integración de Nueva App Científica

Este manual define el proceso obligatorio para conectar una nueva app científica al backend desacoplado basado en core, plugins y jobs asíncronos.

## 1. Objetivo de la integración

Una app científica nueva debe:

- exponer su lógica de dominio como plugin reutilizable
- publicar endpoints HTTP desacoplados
- usar el ciclo de vida estándar de ScientificJob
- documentarse en OpenAPI con contrato estricto
- quedar cubierta con pruebas de contrato y de ejecución

## 2. Estructura mínima esperada

Crear una carpeta nueva bajo backend/apps/<nombre_app>/ con al menos:

- **init**.py
- apps.py
- definitions.py
- types.py
- schemas.py
- plugin.py
- routers.py
- contract.py
- tests.py

Cada archivo debe incluir encabezado de módulo con:

- propósito
- forma de uso
- relación con el flujo de integración

## 3. Paso a paso de conexión

### Paso 1: Definir identidad de app

En definitions.py definir:

- APP_CONFIG_NAME
- APP_ROUTE_PREFIX
- APP_ROUTE_BASENAME
- APP_API_BASE_PATH
- PLUGIN_NAME
- DEFAULT_ALGORITHM_VERSION

Verificar que los valores no colisionen con otras apps registradas.

### Paso 2: Registrar app en startup

En apps.py:

- crear AppConfig
- en ready(), registrar ScientificAppDefinition en ScientificAppRegistry
- importar plugin para activar @PluginRegistry.register(...)

Reglas de validación esperadas:

- plugin_name único
- api_route_prefix único
- api_base_path único

### Paso 3: Implementar tipos estrictos

En types.py:

- definir TypedDict y TypeAlias para input, metadata, result y payload de create
- no usar Any
- tipar explícitamente colecciones

### Paso 4: Implementar plugin desacoplado

En plugin.py:

- validar y normalizar parámetros de entrada
- mantener lógica sin dependencias HTTP
- registrar función con @PluginRegistry.register(PLUGIN_NAME)
- retornar JSONMap estable y serializable

Si aplica pause/resume:

- soportar callback de control
- lanzar JobPauseRequested con checkpoint serializable

### Paso 5: Definir contrato OpenAPI por app

En schemas.py:

- serializer de creación
- serializer de parámetros persistidos
- serializer de resultados
- serializer de respuesta de job
- ejemplos realistas con drf-spectacular

El contrato debe estar alineado con plugin.py y types.py.

### Paso 6: Exponer router dedicado

En routers.py:

- validar request con serializer propio
- delegar creación/consulta a DeclarativeJobAPI o JobService
- usar dispatch_scientific_job para encolado
- devolver respuestas con serializer de salida

No incluir lógica científica en el router.

### Paso 7: Publicar contrato declarativo

En contract.py exponer función get\_<nombre>\_contract() con:

- plugin_name
- version
- supports_pause_resume
- input_type
- result_type
- metadata_type
- execute
- validate_input

### Paso 8: Conectar rutas y settings

Actualizar:

- backend/config/settings.py para incluir AppConfig en INSTALLED_APPS
- backend/config/urls.py para registrar ViewSet en DefaultRouter

### Paso 9: Pruebas obligatorias

En tests.py cubrir mínimo:

- create y retrieve del job
- validaciones de payload inválido
- ejecución de plugin y estructura del resultado
- persistencia de logs/progreso
- comportamiento de pause/resume (si aplica)

## 4. Verificación técnica obligatoria

Antes de cerrar la integración ejecutar:

1. python manage.py check
2. python manage.py test apps.<nombre_app>
3. python manage.py test apps.core
4. python scripts/create_openapi.py

python scripts/create_openapi.py este último paso es crucial para verificar que el contrato OpenAPI se genera correctamente sin errores de serialización o tipado, y que refleja fielmente la estructura definida en schemas.py y plugin.py. Cualquier error en este paso indica problemas de integración que deben resolverse antes de considerar la app como completamente integrada. y genera el codigo del cliente frontend, verificar que el frontend se construye sin errores y que los endpoints de la nueva app científica están disponibles y documentados en la UI de OpenAPI.

## 5. Criterios de aceptación

Se espera que una app nueva quede:

- registrada sin colisiones en startup
- ejecutable por endpoint dedicado y por API core
- documentada en OpenAPI con ejemplos realistas
- tipada estrictamente y sin Any
- con pruebas pasando en local

## 6. Checklist final rápido

- [ ] constants y naming definidos en definitions.py
- [ ] AppConfig registra ScientificAppDefinition en ready()
- [ ] plugin registrado en PluginRegistry
- [ ] serializers alineados con tipos y plugin
- [ ] ViewSet dedicado publicado en urls.py
- [ ] pruebas de contrato y dominio en verde
- [ ] OpenAPI actualizado
- [ ] frontend regenerado si hubo cambios de contrato

---
applyTo: "**/*"
name: "Chemistry Apps - Reglas específicas del sistema"
description: "Guía de integración real del monorepo Chemistry Apps. Complementa backend.instructions.md y frontend.instructions.md."
---

# CHEMISTRY APPS — REGLAS ESPECÍFICAS DEL PROYECTO

Este archivo **complementa** las reglas de backend y frontend. No repite sus normas genéricas: define cómo encajar cambios correctamente en la arquitectura real del repositorio.

---

## 0. PRIORIDADES ABSOLUTAS

1. **Precisión científica**: nunca inventar fórmulas, datos químicos ni resultados.
2. **Respeto a la arquitectura**: cualquier cambio debe encajar en el flujo real del sistema.
3. **Tipado, pruebas y verificación**: no dar una tarea por terminada sin checks reales.
4. **Reutilización**: reutilizar core, wrappers y utilidades existentes antes de crear algo nuevo.

---

## 1. ARQUITECTURA REAL DEL REPOSITORIO

| Zona                                   | Rol real                                                        | Regla clave                                       |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `backend/apps/core/`                   | infraestructura transversal de jobs, identidad, realtime, caché | **nunca** meter lógica científica aquí            |
| `backend/apps/<app>/`                  | una app científica por carpeta                                  | seguir estructura estándar de plugin              |
| `backend/libs/`                        | librerías compartidas                                           | mover aquí el código reutilizable entre apps      |
| `backend/config/`                      | settings, urls, celery, asgi                                    | registrar apps y rutas aquí                       |
| `frontend/src/app/core/api/generated/` | cliente OpenAPI autogenerado                                    | **NO EDITAR**                                     |
| `frontend/src/app/core/api/`           | wrappers estables de API                                        | componentes consumen esto, no `generated/`        |
| `frontend/src/app/core/application/`   | workflows/facades de negocio                                    | el componente no orquesta lógica compleja         |
| `frontend/src/app/core/shared/`        | constantes, config, componentes reutilizables                   | reutilizar antes de duplicar                      |
| `deprecated/`                          | código histórico                                                | no recuperar ni editar sin pedirlo explícitamente |
| `tools/`                               | runtimes y herramientas externas                                | no modificar manualmente                          |

### Reglas estructurales

- El **core nunca importa** de apps científicas.
- Las apps científicas **sí pueden importar** del core.
- Los imports directos entre apps científicas están **prohibidos**.
- Si dos apps comparten lógica, moverla a `backend/libs/`.

---

## 2. FLUJO REAL DEL BACKEND

Flujo obligatorio del sistema:

```text
HTTP request
→ serializer / router
→ RuntimeJobService / JobService
→ Celery task
→ plugin científico
→ progreso + logs + resultados + caché
```

### Reglas de backend

- Django 6 + DRF + drf-spectacular + Celery + Channels.
- Los plugins científicos son funciones desacopladas registradas en `PluginRegistry`.
- El plugin recibe JSON de entrada y retorna JSON serializable.
- La validación del contrato vive en serializers; la lógica científica vive en el plugin/servicios.
- Los errores de validación del plugin deben lanzar `ValueError` con mensaje claro.
- Los errores inesperados deben quedar visibles para `error_trace`; no ocultarlos.
- Si Redis no está disponible, el job puede quedar `pending`; eso es comportamiento normal y el sistema lo recupera.

### Patrones ya presentes en el backend

- **Ports & adapters** en core
- **Factory** en la composición del servicio de runtime
- **Facade** mediante servicios de jobs
- **Repository** y adaptadores Django
- **Result / monads** cuando aporta claridad en lógica de negocio

---

## 3. FLUJO REAL DEL FRONTEND

Flujo obligatorio del frontend:

```text
Component
→ workflow/facade service
→ jobs-api.service / wrapper estable
→ cliente OpenAPI generado
→ HTTP / SSE / WebSocket
```

### Reglas de frontend

- Angular 21 con componentes standalone, signals y lazy loading.
- Los componentes **no llaman** directamente al código de `generated/`.
- `jobs-api.service.ts`, `identity-api.service.ts`, `smileit-api.service.ts` y workflows son la capa estable.
- El realtime oficial usa:
  - SSE para eventos de job
  - WebSocket para stream global de jobs
  - polling solo como fallback explícito
- La base URL del backend debe salir de environments y constantes compartidas.
- Todo lo visual va en **inglés**. Comentarios y lógica pueden estar en español.

---

## 4. OPENAPI Y CÓDIGO GENERADO

### Regla fundamental

Si cambia un serializer, endpoint o contrato del backend, el flujo correcto es:

1. actualizar backend
2. regenerar OpenAPI con `create_openapi.py`
3. revisar el código generado
4. adaptar wrappers estables en frontend
5. verificar build y tests

### Prohibiciones

- no parchear archivos dentro de `generated/`
- no hardcodear endpoints en componentes
- no saltarse wrappers para “hacerlo rápido”

---

## 5. INTEGRACIÓN DE NUEVAS APPS CIENTÍFICAS

Toda nueva app científica debe seguir la estructura estándar:

```text
apps.py
definitions.py
types.py
schemas.py
plugin.py
routers.py
contract.py
tests.py
```

### Pasos mínimos

1. crear la app en `backend/apps/<nombre>/`
2. registrar `AppConfig` en settings
3. registrar `ViewSet` en urls
4. importar el módulo `plugin` en `ready()`
5. regenerar OpenAPI
6. registrar la app en la configuración del frontend
7. añadir ruta lazy loading en `app.routes.ts`
8. verificar backend + frontend

Para integración detallada, seguir además `scientific-app-onboarding.instructions.md`.

---

## 6. DATOS CIENTÍFICOS Y EXACTITUD

### Reglas críticas

- Nunca inventar datos químicos, fórmulas, nombres de compuestos o resultados de cálculo.
- Toda lógica científica debe ser verificable y reproducible.
- Usar unidades estándar y dejar claras las conversiones.
- Si un valor científico falta o es ambiguo, indicarlo explícitamente.
- No asumir que un archivo de entrada es válido: validar siempre.

### Fixtures y datos reales

- Para Gaussian logs y otros insumos científicos, preferir fixtures reales del repositorio.
- No crear datos “de ejemplo” que parezcan científicamente válidos si no lo son.

---

## 7. CONVENCIONES DE CÓDIGO

### Reglas comunes

- Nombres de variables y funciones en **inglés descriptivo**.
- Comentarios y docstrings en **español** cuando aporten valor.
- Preferir claridad sobre cleverness.
- Mantener archivos y funciones pequeños, pero sin fragmentación absurda.
- Eliminar código muerto, ramas obsoletas y archivos sin uso.

### Backend

- Seguir `backend.instructions.md` como fuente principal de estilo.
- Usar tipado estricto, arquitectura hexagonal y manejo explícito de errores.
- No usar `Any`, `type: ignore`, `NOSONAR` o supresiones salvo justificación fuerte y comentada.

### Frontend

- Seguir `frontend.instructions.md` como fuente principal de estilo.
- Usar Angular moderno: standalone, signals, `@if`, `@for`, `@switch`.
- No usar `as any`, `@ts-ignore` ni acceso directo a HTTP desde componentes.

---

## 8. PRUEBAS — OBLIGATORIO

### Backend

- Los tests del plugin prueban la función del plugin directamente.
- Los tests de router validan status code, estructura de respuesta y efectos laterales.
- Cubrir al menos:
  - payload válido
  - payload inválido
  - progreso/logs
  - resultado correcto
  - casos límite científicos

### Frontend

- Los tests verifican comportamiento visible o estado resultante, no detalles internos.
- Usar `TestBed` con inputs controlados.
- No escribir tests triviales que solo comprueben que algo “se crea”.

### Regla de cierre

Antes de terminar una tarea relevante, verificar con evidencia real:

- `python manage.py check`
- tests afectados del backend
- `create_openapi.py` si cambió contrato
- `npm run build` si cambió frontend
- tests/lint afectados si aplica

---

## 9. SEGURIDAD Y ROBUSTEZ

- Nunca exponer secretos, tokens ni credenciales.
- Nunca confiar en input del cliente.
- Sanitizar payloads, archivos y parámetros.
- Evitar ejecución insegura o dinámica sin validación fuerte.
- Manejar los errores en la capa correcta:
  - serializer → contrato
  - plugin/service → dominio
  - adapter/wrapper → infraestructura

---

## 10. DOCUMENTACIÓN Y ALCANCE

- La documentación principal del proyecto es `README.md`.
- No crear archivos `.md` extra no solicitados fuera de `.github/instructions/`.
- Si cambia arquitectura, flujo o comandos importantes, actualizar `README.md`.
- No documentar cosas obvias; documentar decisiones, restricciones y lógica compleja.

---

## 11. COMANDOS DE REFERENCIA

### Backend

```bash
cd backend
poetry run python manage.py check && echo listo
poetry run python manage.py test apps.core apps.<nombre_app> --verbosity=2 && echo listo
poetry run ruff check . && echo listo
poetry run python ../scripts/create_openapi.py && echo listo
```

### Frontend

```bash
cd frontend
npm run build && echo listo
npm run test:coverage && echo listo
npx eslint . --format json > eslint.json && echo listo
```

---

## REGLA META — ORDEN DE DECISIÓN

1. **Exactitud científica**
2. **Respeto a la arquitectura real del monorepo**
3. **Tipado y contratos correctos**
4. **Reutilización de core/wrappers/utilidades existentes**
5. **Pruebas y verificación con evidencia**
6. **Limpieza y mantenibilidad**

Si una regla general de backend o frontend entra en conflicto con la claridad local, se puede simplificar **solo** con justificación explícita en comentario. Si una abstracción funcional o patrón de diseño complica el código sin beneficio real, preferir la solución más simple, manteniendo el tipado y el contrato correctos.

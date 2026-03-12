---
applyTo: "frontend/src/**/*.{ts,html,scss}"
---

# Frontend OpenAPI Integration Instructions

Estas reglas son obligatorias cuando el backend cambie contratos, especialmente al integrar una nueva app científica.

## 1. Ubicación y manejo de código generado

- Los contratos generados desde OpenAPI deben ubicarse exclusivamente en frontend/src/app/core/api/generated/.
- Bajo ninguna circunstancia se debe editar manualmente el código autogenerado en ese directorio.
- Cualquier ajuste debe propagarse regenerando desde la fuente OpenAPI del backend.

## 2. Generación y scripts

- Usar scripts npm existentes en frontend/package.json para generación de cliente.
- Si falta script, agregarlo en package.json (ejemplo: npm run api:generate).
- No ejecutar flujos manuales dispersos fuera de scripts versionados.

## 3. Wrappers obligatorios

- Proteger el contrato generado con wrappers en frontend/src/app/core/api/.
- Los componentes visuales y servicios de dominio no deben depender directamente de generated/.
- Mapear modelos generados a modelos locales cuando ayude a estabilidad semántica.

## 4. Configuración de base URL

- No hardcodear URLs de backend en componentes o servicios.
- Usar environments y constantes compartidas para API base URL.
- La URL base debe ser reutilizable tanto por wrappers como por cliente autogenerado.

## 5. Angular moderno y plantillas limpias

- Usar operadores de control de flujo modernos de Angular (@if, @for, etc.) para evitar duplicación.
- Mantener strict mode de TypeScript y tipado estricto de respuestas OpenAPI.
- Priorizar compatibilidad con versión actual de Angular.

## 6. Validación después de nueva app científica

Cuando se conecte una nueva app científica en backend:

1. regenerar schema OpenAPI
2. regenerar cliente frontend
3. adaptar wrappers de frontend
4. verificar build/test del frontend

Referencia de proceso backend:

- consultar .github/instructions/scientific-app-onboarding.instructions.md
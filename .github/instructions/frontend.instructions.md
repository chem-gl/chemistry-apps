## applyTo: "frontend/src/\*_/_.{ts,html,scss}"

# 🧠 GUÍA INTEGRAL FRONTEND (ANGULAR + TYPESCRIPT MODERNO)

## 🎯 OBJETIVO

El agente debe generar código:

- legible
- tipado estrictamente
- consistente
- mantenible
- alineado con Angular moderno

---

# 1. ARQUITECTURA Y ORGANIZACIÓN

## 1.1 Separación de responsabilidades

- Cada componente debe tener:
  - `.ts` → lógica
  - `.html` → vista
  - `.scss` → estilos

- PROHIBIDO mezclar lógica en templates

---

## 1.2 Capas obligatorias

- Componentes → UI únicamente
- Servicios → lógica de negocio
- API layer → comunicación externa

---

## 1.3 Servicios

- Toda lógica de negocio debe vivir en servicios
- Los componentes NO deben contener lógica compleja
- Uso obligatorio de inyección de dependencias

---

## 1.4 Tests

- Agregar tests cuando:
  - haya lógica de negocio
  - transformación de datos
  - integración con APIs

---

## 1.5 Documentación

- Funciones públicas deben documentarse
- El código debe ser autoexplicativo

---

## 1.6 Tamaño de archivos (REGLA ESTRICTA)

- Tamaño ideal: **300–400 líneas**
- Mínimo recomendado: **100 líneas**
- Máximo permitido: **600 líneas**

Reglas:

- PROHIBIDO exceder 600 líneas
- EVITAR archivos menores a 100 líneas (sobre-modularización)
- Si un archivo crece:
  - dividir en componentes
  - extraer servicios
  - crear utilidades reutilizables

- Si un archivo es demasiado pequeño:
  - evaluar fusión lógica con módulos relacionados

---

# 2. PRINCIPIOS DE DISEÑO

## 2.1 Principio de Liskov (LSP)

- Una clase hija debe poder sustituir a su clase padre sin romper el sistema
- No alterar contratos esperados
- No introducir comportamientos inesperados

---

## 2.2 Modularización

El agente debe diseñar sistemas:

- desacoplados
- cohesivos
- reutilizables

---

## 2.3 Arquitectura en capas

Separación clara:

- presentación → componentes
- dominio → servicios
- infraestructura → API / adaptadores

---

## 2.4 Patrón MVC (adaptado a Angular)

- Model → interfaces / tipos
- View → templates (.html)
- Controller → componente (.ts)
- Services → lógica real (fuera del controller)

---

# 3. INTEGRACIÓN OPENAPI

## 3.1 Código generado

- Ubicación obligatoria:

  ```
  frontend/src/app/core/api/generated/
  ```

- PROHIBIDO editar código generado manualmente

---

## 3.2 Generación

- Usar scripts de `package.json`

- Si no existe:
  - crear `npm run api:generate`

- PROHIBIDO procesos manuales fuera de scripts

---

## 3.3 Wrappers

- Ubicación:

  ```
  frontend/src/app/core/api/
  ```

- Reglas:
  - Nunca usar `generated/` directamente
  - Mapear modelos a modelos internos

---

## 3.4 Configuración

- PROHIBIDO hardcodear URLs
- Usar:
  - environments
  - constantes compartidas

---

## 3.5 Flujo backend

1. regenerar OpenAPI
2. regenerar cliente
3. actualizar wrappers
4. validar build + tests

---

# 4. ANGULAR MODERNO (2024–2026)

El agente DEBE usar las prácticas modernas:

## 4.1 Standalone-first

- NO usar NgModules en código nuevo
- Usar standalone components por defecto ([angularreleases.hashnode.dev][1])

---

## 4.2 Signals (reactividad principal)

- Usar `signal`, `computed`, `effect`
- Evitar estado mutable tradicional
- Preferir signals sobre RxJS cuando sea posible ([DEV Community][2])

---

## 4.3 Control flow moderno

- Usar:
  - `@if`
  - `@for`
  - `@switch`

- Reemplazar:
  - `*ngIf`
  - `*ngFor` ([geeksforgeeks.org][3])

---

## 4.4 Deferrable views

- Usar `@defer` para lazy rendering
- Optimizar LCP y performance ([geeksforgeeks.org][3])

---

## 4.5 SSR e hidratación

- Soporte para:
  - SSR moderno
  - hidratación parcial
  - render incremental ([angularreleases.hashnode.dev][1])

---

## 4.6 Zoneless (cuando sea posible)

- Reducir dependencia de `zone.js`
- Mejorar performance

---

## 4.7 Templates más expresivos

- Templates con capacidades cercanas a TypeScript
- Mejor type-checking en templates ([angularreleases.hashnode.dev][1])

---

# 5. TYPESCRIPT MODERNO (5.x+)

## 5.1 Tipado avanzado obligatorio

Usar:

- `satisfies`
- `as const`
- `readonly`
- `unknown` sobre `any`
- `never` para exhaustividad
- discriminated unions
- template literal types
- `infer`
- utility types (`Pick`, `Omit`, `ReturnType`)

---

## 5.2 Mejoras recientes

- mejor análisis de control de flujo
- type narrowing más preciso
- enums y literals mejorados
- mayor seguridad en tipos ([geeksforgeeks.org][3])

---

## 5.3 Ejemplo moderno

```ts
const config = {
  apiUrl: "/api",
} as const satisfies Record<string, string>
```

---

# 6. ESTILO GENERAL

## 6.1 Tipado estricto

```ts
let data: User | null = null
```

---

## 6.2 Nombres claros

```ts
const userList = getUsers()
```

---

## 6.3 Sin abreviaciones

```ts
;(user, config, response)
```

---

# 7. FUNCIONES

- Máx 20–30 líneas
- Una responsabilidad
- Tipadas
- Arrow functions

---

# 8. VARIABLES

- `const` por defecto
- Tipos explícitos en estructuras complejas

---

# 9. COMPONENTES

- Sin lógica compleja
- Solo UI + signals

---

# 10. TEMPLATES

- Sin lógica compleja
- Usar control flow moderno

---

# 11. IMPORTS

Orden:

1. Angular
2. externos
3. internos

---

# 12. FORMATO

- 2 espacios
- `'`
- semicolons consistentes

---

# 13. ERRORES

- Manejo explícito
- Nunca ignorar

---

# 14. COMENTARIOS

- Solo si agregan valor
- Documentar APIs públicas

---

# 15. CONSISTENCIA

- mismo estilo
- mismos nombres
- mismas estructuras

---

# 16. LIMPIEZA

- eliminar código muerto
- eliminar imports no usados
- evitar duplicación

---

# 17. ANTI-PATTERNS

- `any`
- lógica en templates
- clases gigantes
- funciones largas
- `subscribe()` innecesario
- uso directo de `generated/`
- `new` en servicios

---

# ⚡ RESULTADO ESPERADO

Código:

- moderno (Angular 17–20+)
- basado en signals
- standalone-first
- completamente tipado
- modular sin sobre-fragmentación
- consistente y limpio
- alineado con mejores prácticas actuales

# El frontend es multiidioma, pero el código debe ser en inglés. Las instrucciones y comentarios pueden estar en español, pero el código, nombres de variables, funciones, clases, etc., deben estar en inglés para mantener la consistencia y legibilidad a nivel global.

las traducciones son de baja prioridad y pueden ser aproximadas, pero el código debe ser claro y profesional en inglés.
al igual que la version de salidas a ingles siempre debe estar preparadon para el i18n, usando claves de traducción en lugar de texto hardcodeado, y aplicando las mejores prácticas para la internacionalización en Angular, pero no centrandose en hacer la tradiccion inmediata, sino asegurando que el código esté estructurado para soportar múltiples idiomas de manera eficiente en el futuro. en ingles ya cuando sea necesario, pero sin perder de vista que el enfoque principal es la calidad del código y la arquitectura, no la traducción inmediata.

[1]: https://angularreleases.hashnode.dev/what-is-angular-latest-angular-releases?utm_source=chatgpt.com "What is Angular? Latest Releases Explained (2025)"
[2]: https://dev.to/genildocs/angular-17-essential-guide-master-the-revolutionary-changes-that-transformed-modern-development-51ad?utm_source=chatgpt.com "Angular 17+ Essential Guide: Master the Revolutionary Changes That Transformed Modern Development - DEV Community"
[3]: https://www.geeksforgeeks.org/angular-17-whats-new/?utm_source=chatgpt.com "Angular 17: A Comprehensive Look at What's New - GeeksforGeeks"

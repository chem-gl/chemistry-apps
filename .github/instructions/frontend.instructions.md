---
applyTo: "frontend/src/**/*.{ts,html,scss}"
---

Para el front end es escencial sismpre tener para todos los componetes separada la logica en sus archivos components .ts y la parte visual en sus archivos .html y .scss, esto es para mantener una buena organizacion del codigo y facilitar su mantenimiento. Ademas, es importante seguir las buenas practicas de Angular para asegurar que el codigo sea escalable y facil de entender para otros desarrolladores. asi como sus test de ser necesarios

se debe tener todo bien documentado y siempre separar la logica de negocio fuera en una capa de serivios separados de los controladores y componentes, esto es para mantener una buena organizacion del codigo y facilitar su mantenimiento. Ademas, es importante seguir las buenas practicas de Angular para asegurar que el codigo sea escalable y facil de entender para otros desarrolladores. asi como sus test de ser necesarios

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

# 🧠 GUÍA DE ESTILO PARA AGENTE (GENERACIÓN DE CÓDIGO)

## 🎯 OBJETIVO

El agente debe generar código que sea:

- legible
- tipado estrictamente
- consistente
- mantenible
- moderno (Angular + TS actual)

---

# 1. ESTILO GENERAL DE CÓDIGO

## 1.1 Código SIEMPRE explícito

### ❌ PROHIBIDO

```ts
let data;
```

### ✅ OBLIGATORIO

```ts
let data: User | null = null;
```

---

## 1.2 Nombres claros y semánticos

### ❌

```ts
const x = get();
```

### ✅

```ts
const userList = getUsers();
```

---

## 1.3 Evitar abreviaciones

### ❌

```ts
(usr, cfg, res);
```

### ✅

```ts
(user, config, response);
```

---

# 2. FUNCIONES

## 2.1 Siempre tipadas

```ts
function getUser(id: string): Promise<User> {}
```

---

## 2.2 Funciones pequeñas (máx 20–30 líneas)

Si excede → dividir automáticamente

---

## 2.3 Una responsabilidad por función

### ❌

```ts
function processUser() {
  validate();
  transform();
  save();
}
```

### ✅

```ts
function validateUser() {}
function transformUser() {}
function saveUser() {}
```

---

## 2.4 Arrow functions por defecto

```ts
const getUser = (id: string): Promise<User> => {};
```

---

# 3. VARIABLES

## 3.1 `const` por defecto

### ❌

```ts
let user = ...
```

### ✅

```ts
const user = ...
```

---

## 3.2 Tipos complejos definidos

```ts
type UserState = {
  loading: boolean;
  data: User | null;
};
```

---

# 4. ANGULAR (ESTILO MODERNO)

## 4.1 Componentes limpios

- SIN lógica compleja
- SOLO UI + signals

```ts
@Component({...})
export class UserComponent {
  user = signal<User | null>(null)
}
```

---

## 4.2 Signals obligatorios

```ts
const count = signal<number>(0);
```

---

## 4.3 Computed SIEMPRE para derivados

```ts
const fullName = computed<string>(() => user()?.name ?? "");
```

---

## 4.4 Effects solo para side effects

```ts
effect(() => {
  console.log(user());
});
```

---

# 5. HTML / TEMPLATES

## 5.1 Usar control flow moderno

### ❌

```html
<div *ngIf="user"></div>
```

### ✅

```html
@if (user) {
```

---

## 5.2 No lógica compleja en HTML

### ❌

```html
{{ user?.name?.toUpperCase()?.trim() }}
```

### ✅

```ts
const userName = computed(() => ...)
```

---

## 5.3 Reutilización obligatoria

Si el HTML se repite → crear componente

---

# 6. IMPORTS

## 6.1 Orden obligatorio

1. Angular
2. librerías externas
3. internos (app)

---

## 6.2 Tipos separados

```ts
import type { User } from "./user.model";
```

---

# 7. FORMATO

## 7.1 Indentación

- 2 espacios

---

## 7.2 Comillas

- `'` (single quotes)

---

## 7.3 Semicolons

- opcionales pero consistentes (preferible sí)

---

# 8. ERRORES Y VALIDACIÓN

## 8.1 Manejo explícito

```ts
if (!user) {
  throw new Error("User not found");
}
```

---

## 8.2 Nunca ignorar errores

### ❌

```ts
try {
} catch {}
```

---

# 9. TIPADO AVANZADO

## 9.1 Preferir inferencia cuando es clara

```ts
const users = getUsers(); // TS infiere
```

---

## 9.2 Pero tipar en APIs públicas

```ts
function getUsers(): Promise<User[]> {}
```

---

## 9.3 Usar utility types

```ts
type PartialUser = Partial<User>;
```

---

# 10. COMENTARIOS

## 10.1 Solo cuando agregan valor

### ❌

```ts
// increment count
count++;
```

### ✅

```ts
// evita race condition en actualizaciones concurrentes
```

---

## 10.2 Documentar funciones públicas

```ts
/**
 * Obtiene usuario por ID
 */
function getUser(id: string): Promise<User>;
```

---

# 11. CONSISTENCIA

El agente debe mantener:

- mismo estilo en todo el repo
- mismos nombres para conceptos iguales
- misma estructura en archivos similares

---

# 12. REGLAS DE LIMPIEZA AUTOMÁTICA

El agente debe:

- eliminar código muerto
- eliminar imports no usados
- evitar duplicación
- simplificar expresiones

---

# 13. ANTI-PATTERNS PROHIBIDOS

El agente debe rechazar:

- `any`
- lógica en templates
- funciones largas
- clases gigantes
- duplicación de código
- `subscribe()` innecesario
- `new` en servicios

---

# ⚡ RESUMEN PARA COPILOT

Generar código que:

- esté completamente tipado
- use signals
- use control flow moderno
- tenga funciones pequeñas
- tenga nombres claros
- evite duplicación
- sea consistente en todo el proyecto

---

# 🧠 RESULTADO ESPERADO

Código que se vea como:

- escrito por un senior
- fácil de leer
- fácil de mantener
- alineado con Angular moderno
- sin errores ocultos

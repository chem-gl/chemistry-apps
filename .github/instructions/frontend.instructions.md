---
  name: Frontend (Angular + TypeScript moderno)
  description: Guía de estilo y arquitectura para el frontend (Angular + TypeScript moderno).
  applyTo: "frontend/src/**/*.{ts,html,scss}"
---

# GUÍA FRONTEND (ANGULAR + TYPESCRIPT MODERNO)

> Usar el navegador web integrado para verificar cambios del frontend.

Generar código: legible, tipado estrictamente, consistente, mantenible, alineado con Angular moderno.

## 1. ARQUITECTURA

**Capas obligatorias** (separación estricta):

- Componentes → UI + signals únicamente; **PROHIBIDO** lógica compleja
- Servicios → lógica de negocio; inyección de dependencias obligatoria
- API layer → comunicación externa; wrapping de código generado

Cada componente: `.ts` (lógica) · `.html` (vista) · `.scss` (estilos). **PROHIBIDO** mezclar lógica en templates.

MVC adaptado: Model = interfaces/tipos · View = `.html` · Controller = `.ts` · Lógica real = servicios.

Tests requeridos cuando haya: lógica de negocio, transformación de datos, integración con APIs.

**> TAMAÑO DE ARCHIVOS — REGLA CRÍTICA:** ideal 300–400 líneas · mínimo 100 · **MÁXIMO ABSOLUTO 600** (nunca superar). Si crece: dividir en componentes/servicios/utilidades. Si es muy pequeño: fusionar con módulos relacionados.

## 2. OPENAPI

- Código generado → `frontend/src/app/core/api/generated/` — **PROHIBIDO editar manualmente**
- Wrappers → `frontend/src/app/core/api/` — **NUNCA** usar `generated/` directamente; mapear a modelos internos
- Generación via `npm run api:generate`; **PROHIBIDO** procesos manuales
- **PROHIBIDO** hardcodear URLs; usar `environments` o constantes
- Flujo al cambiar backend: regenerar OpenAPI → regenerar cliente → actualizar wrappers → validar build+tests

## 3. ANGULAR v21+ — ESTÁNDARES ACTUALES OBLIGATORIOS

> Versión de referencia: Angular **v21** . Todas las APIs marcadas son estables

### 3.1 Fundamentos (siempre aplicar)

| Práctica         | Regla                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Standalone-first | **NO** NgModules en código nuevo                                                |
| Control flow     | `@if` `@for` `@switch`; **REEMPLAZAR** `*ngIf` `*ngFor`                         |
| Deferrable views | `@defer` con triggers (`on viewport`, `on idle`, `on interaction`, `when cond`) |
| Zoneless         | Reducir dependencia de `zone.js`; usar `ChangeDetectionStrategy.OnPush`         |
| SSR              | Hidratación parcial y render incremental                                        |
| Build            | Vite + esbuild (pipeline moderno, no webpack legacy)                            |

### 3.2 Signals API — PRIORIDAD MÁXIMA sobre RxJS

**> Usar signals para todo estado reactivo. RxJS solo para streams async complejos o interop.**

| API                                  | Uso                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `signal<T>(value)`                   | estado local mutable                                                                  |
| `computed(() => ...)`                | derivaciones lazy memoizadas; solo lectura                                            |
| `linkedSignal(() => ...)`            | estado derivado **y escribible**; se resetea cuando cambia la fuente                  |
| `effect(() => ...)`                  | efectos secundarios sobre APIs no reactivas; **nunca** para derivar estado            |
| `untracked(() => signal())`          | leer signal sin crear dependencia en un contexto reactivo                             |
| `resource({ params, loader })`       | datos async reactivos (**experimental**); estado con `.value`, `.isLoading`, `.error` |
| `httpResource(() => url)`            | wrapper de `HttpClient` con respuesta como signal (**experimental**)                  |
| `input<T>()` / `input.required<T>()` | reemplaza `@Input()` — signal de solo lectura                                         |
| `output<T>()`                        | reemplaza `@Output()` / `EventEmitter`                                                |
| `model<T>()`                         | two-way binding como signal escribible                                                |

```ts
// ✅ linkedSignal: estado dependiente y escribible
selectedOption = linkedSignal(() => this.options()[0])

// ✅ resource: datos async con signals
userResource = resource({
  params: () => ({ id: this.userId() }),
  loader: ({ params, abortSignal }) =>
    fetch(`/api/users/${params.id}`, { signal: abortSignal }).then(
      (r) => r.json() as Promise<User>,
    ),
})

// ✅ Signal inputs/outputs modernos
userId = input.required<number>()
userSelected = output<User>()
value = model<string>("")
```

**> PROHIBIDO en código nuevo:** `@Input()` / `@Output()` / `EventEmitter` / `Subject` para estado simple.

## 4. TYPESCRIPT 5.8+ — TIPADO ESTRICTO

> Versión de referencia: TypeScript **5.8** (abril 2026).

**Usar:** `satisfies` · `as const` · `readonly` · `never` (exhaustividad) · discriminated unions · template literal types · `infer` · utility types (`Pick`, `Omit`, `ReturnType`)

**Novedades TS 5.8 a aprovechar:**

- **Granular checks en return ternarios**: TS 5.8 detecta bugs en `return cond ? a : b` con `any`; **no usar `any` en caches o maps intermedios**
- **Import attributes** (`with` keyword): usar `import data from './data.json' with { type: 'json' }` — la sintaxis `assert` está obsoleta
- **`--erasableSyntaxOnly`**: evitar `enum`, parameter properties en clases, `namespace` con runtime code (preferir `const` objects sobre `enum`)

**> REGLAS CRÍTICAS DE TIPADO (nunca ignorar sin justificación):**

| Prohibido                                                 | En su lugar                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `any`                                                     | tipos concretos, uniones `A\|B`, genéricos `T`                    |
| `unknown` sin validar                                     | solo cuando el tipo realmente no se conoce; validar antes de usar |
| `Array` sin tipo                                          | `T[]` o `Array<T>`                                                |
| `{}` como tipo                                            | interfaz definida o `Record<string, unknown>`                     |
| `Function` como tipo                                      | firma explícita `(args: T) => R`                                  |
| `as` abusivo / doble assertion                            | corregir el diseño de tipos                                       |
| `// @ts-ignore` / `@ts-nocheck`                           | refactorizar el tipo                                              |
| `eslint-disable` / `NOSONAR` para ocultar errores de tipo | resolver el error correctamente                                   |
| `Partial<T>` / `Record<string, any>` sin control          | tipar correctamente                                               |
| uniones excesivas `A\|B\|C\|D...`                         | tipos discriminados o interfaces                                  |

**> Si necesitas usar `any`, `as`, `ts-ignore` o deshabilitar linter → el diseño de tipos es incorrecto: refactorizar.** Si el refactor es avisar pero se debe hacer de inmediato, justificar claramente en un comentario por qué es necesario y cómo se resolverá a futuro.

Ejemplo moderno:

```ts
const config = { apiUrl: "/api" } as const satisfies Record<string, string>
```

## 5. PROGRAMACIÓN FUNCIONAL Y MODULAR — PRIORIDAD ALTA

> El tipado y la programación funcional son **primera prioridad**. Antes de escribir cualquier lógica, definir los tipos. Toda transformación de datos debe seguir el paradigma funcional.

### 5.1 Paradigma: diferencias clave

| Paradigma       | Enfoque                               | Aplicación en este proyecto                 |
| --------------- | ------------------------------------- | ------------------------------------------- |
| **Modular**     | Organización del código               | Separar responsabilidades en archivos/capas |
| **Declarativa** | Qué hacer (no cómo)                   | Templates Angular, operadores RxJS/señales  |
| **Funcional**   | Transformar datos con funciones puras | Servicios, utilidades, lógica de negocio    |

### 5.2 Programación funcional estricta

**> REGLAS CRÍTICAS (nunca ignorar sin justificación):**

- **Funciones puras obligatorias**: mismo input → siempre mismo output, sin efectos secundarios ocultos
- **Inmutabilidad**: nunca mutar estado; usar `readonly`, spread `{...obj}`, `[...arr]`
- **Composición sobre herencia**: encadenar funciones pequeñas en lugar de clases grandes
- **Declarativo sobre imperativo**: describir _qué_ se quiere, no _cómo_ hacerlo paso a paso

```ts
// ❌ Imperativo
const results: User[] = []
for (const user of users) {
  if (user.active) results.push({ ...user, name: user.name.toUpperCase() })
}

// ✅ Funcional declarativo
const results = users
  .filter((user) => user.active)
  .map((user) => ({ ...user, name: user.name.toUpperCase() }) satisfies User)
```

### 5.3 Mónadas para manejo de errores — OBLIGATORIO

**> Nunca usar `throw`/`try-catch` como flujo de control principal.** Usar tipos que representen éxito y error de forma explícita.

Patrón `Result<T, E>` obligatorio en operaciones que pueden fallar:

```ts
// Tipo Result — definir en shared/types/result.type.ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

// Uso en servicios
const parseSmiles = (input: string): Result<Molecule, ParseError> => {
  if (!input.trim()) return { ok: false, error: new ParseError("empty input") }
  return { ok: true, value: parseMolecule(input) }
}

// Consumo — sin try/catch
const result = parseSmiles(rawInput)
if (!result.ok) {
  // manejar error tipado
  return
}
// result.value está disponible y tipado
```

- **Encadenar** con `map`/`flatMap` en lugar de `if` anidados
- **Nunca retornar `null`/`undefined`** para indicar fallo; usar `Result` o `Option<T>`
- Los errores son **datos tipados**, no strings o códigos ambiguos
- En RxJS: usar `catchError` + `of({ ok: false, error })` en lugar de propagar excepciones

### 5.4 Modularidad estricta

- Un archivo = una responsabilidad clara y específica
- Funciones pequeñas (máx 20–30 líneas), reutilizables, sin efectos secundarios
- Extraer utilidades puras a `shared/utils/` cuando se usan en más de un lugar
- Composición de funciones para construir transformaciones complejas:

```ts
// ✅ Composición funcional tipada
const processUserData = (raw: RawUser[]): ProcessedUser[] =>
  raw.filter(isActiveUser).map(normalizeUser).map(enrichWithPermissions)
```

## 6. PATRONES DE DISEÑO Y POO — OBLIGATORIO

> El código debe seguir principios de **encapsulamiento, abstracción y bajo acoplamiento**. Los patrones son herramientas, no decoración — aplicar solo cuando aporten claridad real.

### 6.1 Principios OOP que siempre aplican

| Principio                 | Regla en Angular/TS                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| **Encapsulamiento**       | Estado interno `private readonly`; exponer solo lo necesario via getters o `asReadonly()` |
| **Abstracción**           | Interfaces/tipos para contratos; el consumidor no conoce la implementación                |
| **Cohesión**              | Cada clase/servicio tiene una sola razón para cambiar (SRP)                               |
| **Bajo acoplamiento**     | Depender de abstracciones (interfaces), no de implementaciones concretas                  |
| **Sustitución de Liskov** | Implementaciones deben respetar el contrato de la interfaz sin sorpresas                  |

```ts
// ✅ Encapsulamiento correcto en servicio con signals
@Injectable({ providedIn: "root" })
export class UserStateService {
  private readonly _currentUser = signal<User | null>(null)
  readonly currentUser = this._currentUser.asReadonly() // solo lectura pública

  setUser(user: User): void {
    this._currentUser.set(user)
  }
}
```

### 6.2 Patrones de diseño — cuándo y cómo aplicar

**> Aplicar el patrón más simple que resuelva el problema. No sobre-ingenierizar.**

| Patrón                   | Cuándo usarlo                                              | Implementación en Angular                                           |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| **Factory**              | Crear objetos complejos sin exponer lógica de construcción | Función factoría tipada o servicio con método `create*`             |
| **Builder**              | Construir objetos con muchos parámetros opcionales         | Clase con métodos encadenables (`withX().withY().build()`)          |
| **Adapter**              | Integrar APIs externas/generadas con modelos internos      | Wrapper services sobre `generated/`; mappers tipados                |
| **Facade**               | Simplificar acceso a subsistemas complejos                 | Servicio que agrupa múltiples servicios internos                    |
| **Repository**           | Abstraer el acceso a datos del dominio                     | Servicio que encapsula llamadas HTTP; componentes no conocen la API |
| **Strategy**             | Intercambiar algoritmos/comportamientos en runtime         | Interfaz + implementaciones inyectables via DI                      |
| **Observer**             | Reaccionar a cambios de estado                             | Signals + `effect`; RxJS para streams externos                      |
| **Dependency Injection** | Desacoplar dependencias                                    | Angular DI estándar; `inject()` en lugar de constructores largos    |

```ts
// ✅ Factory: crear entidades del dominio
const createMolecule = (
  smiles: string,
  name: string,
): Result<Molecule, ValidationError> => {
  if (!isValidSmiles(smiles))
    return { ok: false, error: new ValidationError("invalid SMILES") }
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      smiles,
      name,
      createdAt: new Date(),
    } satisfies Molecule,
  }
}

// ✅ Adapter: wrapper sobre generated/ con mapeo a modelo interno
@Injectable({ providedIn: "root" })
export class MoleculeApiAdapter {
  private readonly api = inject(MoleculeControllerService) // generated

  getMolecule(id: string): Observable<Result<Molecule, ApiError>> {
    return this.api.retrieve({ id }).pipe(
      map(
        (dto) =>
          ({ ok: true, value: mapDtoToMolecule(dto) }) satisfies Result<
            Molecule,
            ApiError
          >,
      ),
      catchError((err) =>
        of({ ok: false, error: mapHttpError(err) } satisfies Result<
          Molecule,
          ApiError
        >),
      ),
    )
  }
}

// ✅ Facade: simplificar acceso a múltiples servicios
@Injectable({ providedIn: "root" })
export class ChemistryFacade {
  private readonly molecules = inject(MoleculeApiAdapter)
  private readonly properties = inject(PropertyCalculatorService)

  analyzeCompound(smiles: string): Observable<Result<Analysis, AppError>> {
    // componentes solo interactúan con esta facade
    return this.molecules
      .getBySmiles(smiles)
      .pipe(
        switchMap((result) =>
          result.ok ? this.properties.calculate(result.value) : of(result),
        ),
      )
  }
}

// ✅ Strategy: comportamiento intercambiable via DI
interface ExportStrategy {
  export(data: MoleculeData[]): Blob
}
// Implementaciones: CsvExportStrategy, JsonExportStrategy, SdfExportStrategy
// Inyectar la estrategia correcta según contexto
```

### 6.3 Estructura de carpetas que refleja los patrones

```
core/
  api/
    generated/        ← NUNCA tocar directamente
    adapters/         ← Adapter pattern: mapean generated/ → modelos internos
  facades/            ← Facade pattern: simplifican acceso a subsistemas
  repositories/       ← Repository pattern: abstraen acceso a datos
shared/
  factories/          ← Factory/Builder: creación de entidades del dominio
  strategies/         ← Strategy: algoritmos intercambiables
  types/              ← Result<T,E>, Option<T>, contratos/interfaces
```

## 7. ESTILO Y CONVENCIONES

- Nombres descriptivos, sin abreviaciones: `userList`, `apiResponse`, `currentConfig`
- Funciones: máx 20–30 líneas · una responsabilidad · arrow functions · tipadas
- Variables: `const` por defecto · tipos explícitos en estructuras complejas
- Imports: Angular → externos → internos
- Formato: 2 espacios · comillas simples `'` · semicolons consistentes
- Comentarios solo si agregan valor; documentar funciones públicas
- Errores: manejo explícito, nunca ignorar

## 8. ANTI-PATTERNS — NUNCA HACER

`any` · lógica en templates · clases/funciones gigantes · `subscribe()` innecesario · uso directo de `generated/` · `new` en servicios (usar `inject()`) · código muerto · imports no usados · duplicación · `*ngIf`/`*ngFor` · `throw`/`try-catch` como flujo principal · mutar estado directamente · funciones con efectos secundarios ocultos · retornar `null`/`undefined` para indicar error · estado público mutable en servicios (`signal` sin `asReadonly()`) · implementar patrones sin necesidad real

## 9. I18N Y MULTIIDIOMA

- **Código siempre en inglés** (variables, funciones, clases, tipos)
- Comentarios e instrucciones pueden ser en español
- Usar claves de traducción en lugar de texto hardcodeado (preparar para i18n futuro)
- Traducciones de baja prioridad; el foco es calidad de código y arquitectura

## REGLA META

**Orden de prioridades:**

1. **Tipado completo y correcto** — siempre, sin excepciones
2. **Programación funcional** — funciones puras, inmutabilidad, `Result<T,E>` para errores
3. **Patrones de diseño y encapsulamiento** — OOP bien aplicado, estado encapsulado
4. **Modularidad** — un archivo, una responsabilidad
5. **Declarativo sobre imperativo**
6. El resto de convenciones de estilo

Todas las reglas pueden ignorarse **solo si** se justifica claramente en un comentario en el código por qué hacerlo mejora la claridad o mantenibilidad en ese caso específico. Sin justificación, las reglas son absolutas.

Si mónadas/abstracciones funcionales complican innecesariamente el código → preferir solución más simple, pero **siempre manteniendo tipado completo y manejo explícito de errores**.

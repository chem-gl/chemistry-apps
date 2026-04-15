---
applyTo: "**/*.py"
name: "Python Backend Guide - Django Moderno"
description: "Guía integral para generar código tipado, modular, mantenible, alineado con Python 3.13+ y Django 6.x usando arquitectura hexagonal"
---

# GUÍA BACKEND (PYTHON + DJANGO MODERNO)

## 0. VERSIONES OBLIGATORIAS

| Componente | Versión mínima           |
| ---------- | ------------------------ |
| Python     | **3.13+** (soporta 3.14) |
| Django     | **6.x**                  |

---

## 1. INTEGRACIÓN DE APP CIENTÍFICA — OBLIGATORIO

Seguir `.github/instructions/scientific-app-onboarding.instructions.md`.

Archivos requeridos por app:

```
apps.py  definitions.py  types.py  schemas.py
plugin.py  routers.py  contract.py  tests.py
```

Pasos: registrar en `ready()` → tipado estricto → docs OpenAPI → registrar en settings/urls → validar tests + schema + check.

---

## 2. ARQUITECTURA HEXAGONAL — OBLIGATORIA

### 2.1 Capas

| Capa            | Responsabilidad                            |
| --------------- | ------------------------------------------ |
| `domain/`       | Entidades puras, sin dependencia de Django |
| `services/`     | Lógica de aplicación                       |
| `ports/`        | Interfaces (Protocols/ABCs)                |
| `adapters/`     | Implementaciones (DB, API, cache)          |
| `presentation/` | Views, serializers                         |

**Regla**: el dominio NO importa Django. Django es infraestructura.

### 2.2 Estructura

```
backend/apps/<feature>/
  domain/       services/       ports/
  adapters/     presentation/
```

### 2.3 Tamaño de archivos

- Ideal: **300–400 líneas** — Mínimo: 100 — Máximo: **600** (PROHIBIDO superarlo)
- Dividir por responsabilidad, no sobre-fragmentar

---

## 3. TIPADO ESTRICTO — PRIORIDAD MÁXIMA

### 3.1 Reglas absolutas

| Prohibido               | Usar en cambio                         |
| ----------------------- | -------------------------------------- |
| `Any`                   | tipos concretos, `TypeVar`, `Protocol` |
| `list` sin parametrizar | `list[T]`                              |
| `dict` sin parametrizar | `dict[K, V]`, `TypedDict`              |
| `tuple` sin estructura  | `tuple[T1, T2]` o `tuple[T, ...]`      |
| `Callable` sin firma    | `Callable[[Args], Return]`             |
| `object` genérico       | `Protocol` o `TypeVar`                 |
| `# type: ignore`        | corregir el tipo o refactorizar        |
| `cast` excesivo         | validar desde el origen                |
| `NOSONAR` / supresiones | corregir el error                      |

### 3.2 Python 3.13+ — features obligatorias

| Feature                            | Uso                                       |
| ---------------------------------- | ----------------------------------------- |
| `X \| Y`                           | uniones (reemplaza `Union[X, Y]`)         |
| `type UserId = int`                | alias de tipos (PEP 695)                  |
| `def f[T](x: T) -> T`              | genéricos modernos (PEP 695)              |
| `Self`                             | referencia al tipo propio                 |
| `@override`                        | indicar sobreescritura                    |
| `TypedDict`                        | estructuras dict tipadas                  |
| `dataclass(slots=True)`            | dataclasses eficientes                    |
| `match/case`                       | control de flujo estructural              |
| `ReadOnly` (3.13)                  | campos TypedDict de solo lectura          |
| `TypeIs` (3.13)                    | narrowing de tipos más preciso            |
| `warnings.deprecated` (3.13)       | deprecar con soporte estático             |
| Anotaciones diferidas (3.14)       | sin `from __future__ import annotations`  |
| `types.UnionType` unificado (3.14) | `int \| str` equivale a `Union[int, str]` |

```python
# Correcto — Python 3.13+
type UserId = int

class UserData(TypedDict):
    id: UserId
    name: str
    email: ReadOnly[str]  # solo lectura

def find_user[T: BaseUser](repo: UserPort[T], user_id: UserId) -> T | None:
    ...
```

---

## 4. MÓNADAS PARA MANEJO DE ERRORES — OBLIGATORIO

### 4.1 Patrón Result

No usar excepciones como flujo principal de lógica de negocio. Representar errores como datos:

```python
# types.py — definición del patrón Result
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")
E = TypeVar("E")

@dataclass(frozen=True, slots=True)
class Ok[T]:
    value: T
    ok: bool = True

@dataclass(frozen=True, slots=True)
class Err[E]:
    error: E
    ok: bool = False

type Result[T, E] = Ok[T] | Err[E]
```

```python
# Uso en servicio
def create_molecule(smiles: str) -> Result[Molecule, ValidationError]:
    if not is_valid_smiles(smiles):
        return Err(ValidationError(f"SMILES inválido: {smiles}"))
    return Ok(Molecule(smiles=smiles))

# Consumo
result = create_molecule(smiles)
match result:
    case Ok(value=mol):
        return mol.to_dict()
    case Err(error=err):
        raise Http400(str(err))
```

### 4.2 Reglas

- Retornar `Result[T, E]` en servicios y puertos — nunca `None` ambiguo
- Usar `match/case` para extraer valores, no condicionales anidados
- Propagar errores explícitamente, no silenciarlos
- Excepciones solo para errores inesperados de infraestructura (IO, DB)

---

## 5. PROGRAMACIÓN FUNCIONAL

### 5.1 Principios

| Regla           | Descripción                                    |
| --------------- | ---------------------------------------------- |
| Funciones puras | sin efectos secundarios ocultos                |
| Inmutabilidad   | `dataclass(frozen=True)`, `tuple`, `frozenset` |
| Composición     | encadenar en lugar de anidar `if`              |
| Declarativo     | describir QUÉ, no CÓMO                         |

```python
# Declarativo + composición
def process_molecules(smiles_list: list[str]) -> list[Result[Molecule, str]]:
    return [create_molecule(s) for s in smiles_list]

# Extraer solo los exitosos
valid = [r.value for r in results if isinstance(r, Ok)]
```

### 5.2 Funciones

- Máx **20–30 líneas**, una responsabilidad
- Siempre tipadas: parámetros + retorno
- Sin efectos secundarios en funciones de dominio

---

## 6. PATRONES DE DISEÑO Y POO — OBLIGATORIO

### 6.1 Principios OOP

| Principio         | Aplicación en Django/Python                         |
| ----------------- | --------------------------------------------------- |
| Encapsulamiento   | atributos privados `_name`, propiedades controladas |
| Abstracción       | `Protocol` / ABC para puertos                       |
| SRP               | un archivo = una responsabilidad clara              |
| LSP               | subclases sustituibles, no romper contratos         |
| Bajo acoplamiento | depender de abstracciones, no implementaciones      |

### 6.2 Patrones

| Patrón         | Cuándo usarlo               | Implementación                                  |
| -------------- | --------------------------- | ----------------------------------------------- |
| **Repository** | acceso a datos              | `Protocol` en ports, implementación en adapters |
| **Factory**    | crear objetos complejos     | función/clase que retorna `Result[T, E]`        |
| **Adapter**    | integrar librerías externas | wrapper en `adapters/` con interfaz propia      |
| **Facade**     | simplificar subsistemas     | servicio que orquesta múltiples ports           |
| **Strategy**   | algoritmos intercambiables  | `Protocol` con `__call__` o método único        |
| **Observer**   | eventos de dominio          | Django signals o eventos explícitos             |
| **DI**         | inyección de dependencias   | parámetros en `__init__`, sin `new` interno     |
| **Builder**    | construcción paso a paso    | dataclass + métodos encadenados                 |

```python
# Repository — Puerto
class MoleculeRepository(Protocol):
    def find_by_smiles(self, smiles: str) -> Molecule | None: ...
    def save(self, molecule: Molecule) -> Result[Molecule, str]: ...

# Adapter — Implementación Django ORM
class DjangoMoleculeRepository:
    def find_by_smiles(self, smiles: str) -> Molecule | None:
        try:
            return MoleculeModel.objects.get(smiles=smiles).to_domain()
        except MoleculeModel.DoesNotExist:
            return None

    def save(self, molecule: Molecule) -> Result[Molecule, str]:
        model, _ = MoleculeModel.objects.update_or_create(
            smiles=molecule.smiles,
            defaults=molecule.to_dict(),
        )
        return Ok(model.to_domain())

# Factory con Result
def create_molecule_service(
    repo: MoleculeRepository,
    validator: MoleculeValidator,
) -> MoleculeService:
    return MoleculeService(repository=repo, validator=validator)

# Strategy para algoritmos
class ScoringStrategy(Protocol):
    def score(self, molecule: Molecule) -> float: ...

class SAScoreStrategy:
    def score(self, molecule: Molecule) -> float:
        return calculate_sa_score(molecule.smiles)
```

### 6.3 Estructura de carpetas que refleja patrones

```
apps/<feature>/
  domain/
    entities.py       # dataclasses del dominio
    value_objects.py  # tipos inmutables
  ports/
    repositories.py   # Protocols (Repository pattern)
    services.py       # Protocols de servicios
  adapters/
    django_repo.py    # implementación ORM
    http_adapter.py   # cliente HTTP externo
  services/
    facade.py         # Facade: orquesta ports
    factories.py      # Factory functions
  strategies/
    scoring.py        # Strategy implementations
```

---

## 7. DJANGO MODERNO (6.x)

### 7.1 Features clave

| Feature                                       | Uso                                  |
| --------------------------------------------- | ------------------------------------ |
| `async def` views                             | async-first en views y services      |
| `select_related` / `prefetch_related`         | evitar N+1                           |
| `annotate` / `Subquery` / `Exists`            | lógica en DB                         |
| `JSONField` / `GeneratedField` / `db_default` | modelos modernos                     |
| `UniqueConstraint` / `CheckConstraint`        | validación en DB                     |
| Background tasks nativos                      | `@background` de `django.core.tasks` |
| `AsyncPaginator`                              | paginación async                     |
| `STORAGES = {...}`                            | storage moderno                      |
| CSP nativo                                    | Content Security Policy              |

```python
# Background task
from django.core.tasks import background

@background
async def process_molecule_async(smiles: str) -> None:
    ...

# ORM con annotate
molecules = await Molecule.objects.annotate(
    score=Subquery(Score.objects.filter(molecule=OuterRef("pk")).values("value")[:1])
).filter(score__gt=0.5)
```

### 7.2 Reglas Django

- Validación DB → constraints; validación de negocio → services (no duplicar)
- NO poner lógica en views — delegar siempre a services
- Desarrollo → SQLite; Producción → mismo ORM (sin mocks de DB)
- Admin: siempre `list_display`, `search_fields`, `list_filter`

---

## 8. OPENAPI — OBLIGATORIO

Cada endpoint debe incluir:

```python
@extend_schema(
    summary="...",
    description="...",
    request=RequestSchema,
    responses={200: ResponseSchema, 400: ErrorSchema},
    examples=[OpenApiExample(name="...", value={...})],
)
```

---

## 9. ANTI-PATTERNS — NUNCA HACER

- `Any`, `object` genérico, `cast` sin necesidad
- Excepciones como control de flujo principal → usar `Result[T, E]`
- `except Exception` o `except:` vacío
- Lógica de negocio en views, models o serializers
- Duplicación de validaciones (DB + service + view)
- Archivos > 600 líneas
- Instanciar dependencias con `new` directo dentro de clases → usar DI
- `# type: ignore` sin justificación explícita en comentario
- `from __future__ import annotations` en Python 3.14+ (ya no necesario)
- `Union[X, Y]` en lugar de `X | Y`

---

## REGLA META — ORDEN DE PRIORIDADES

1. **Tipado completo** — `Result[T, E]`, sin `Any`
2. **Arquitectura hexagonal** — dominio puro, ports/adapters
3. **Patrones de diseño y encapsulamiento**
4. **Manejo de errores con mónadas** — `Result` en lógica de negocio
5. **Modularidad** — archivos 300–400 líneas
6. **Async-first** — Django 6 + Python 3.13+
7. **Resto de convenciones**

> Reglas ignorables SOLO si se justifica con comentario en el código explicando por qué y cómo mejora la claridad. Los archivos autogenerados en `**/generated/**` se excluyen de todas las reglas.
>
> Si mónadas o abstracciones funcionales reducen la legibilidad, preferir solución más simple con justificación comentada.

---
applyTo: "**/*.py"
---

# Integración de Nueva App Científica (obligatorio)

Al crear o conectar una nueva app científica en backend se debe seguir el manual:

- .github/instructions/scientific-app-onboarding.instructions.md

Resumen mínimo esperado:

1. crear app con estructura completa (apps.py, definitions.py, types.py, schemas.py, plugin.py, routers.py, contract.py, tests.py)
2. registrar ScientificAppDefinition en ready() y publicar plugin en PluginRegistry
3. tipar estrictamente contratos de entrada/salida sin Any
4. documentar OpenAPI con serializers y ejemplos realistas
5. conectar app en settings.py y urls.py
6. validar con check, tests y regeneración de schema OpenAPI

# Python Strict Typing and API Documentation Instructions

This project requires **strict static typing** and **complete API documentation**.

All generated code must be fully typed and must produce **high-quality OpenAPI documentation**.

Dynamic typing and incomplete documentation are not allowed.

---

# Python Version

Use Python **3.11 or newer**.

Prefer modern typing features.

---

# Strict Typing Requirements

All variables, function arguments, return values, and class attributes MUST have explicit type annotations.

GOOD

def get_user(user_id: int) -> User:
...

BAD

def get_user(user_id):
...

---

# Variable Typing

All variables must have explicit types.

GOOD

user_count: int = 0

BAD

user_count = 0

---

# Forbidden Types

The following types are **strictly forbidden**:

- Any
- typing.Any
- object used as fallback
- untyped lists
- untyped dictionaries
- untyped sets

BAD

data: Any
items: list
mapping: dict

GOOD

data: UserData
items: list[str]
mapping: dict[str, User]

---

# Generics Must Be Fully Specified

Generic types must always specify their type parameters.

BAD

items: list
mapping: dict

GOOD

items: list[str]
mapping: dict[str, User]

---

# Function Typing

All functions must include:

- typed parameters
- explicit return types

GOOD

def create_user(email: str) -> User:
...

---

# Optional Types

Optional values must be declared explicitly.

Example:

user: User | None

---

# Collections

Collections must always define element types.

Examples

list[str]

set[int]

dict[str, User]

tuple[int, str]

---

# Strongly Typed Data Structures

Prefer strongly typed structures:

- dataclasses
- Pydantic models
- typed classes

Example

from dataclasses import dataclass

@dataclass
class User:
id: int
email: str
active: bool

---

# Static Type Checking

All code must pass strict static type checking.

Tools expected:

- mypy
- pyright

---

# No Implicit Typing

Avoid implicit typing when clarity matters.

BAD

items = []

GOOD

items: list[str] = []

---

# Logging

Do not use print statements.

Use the logging module.

Example

logger.info("User created")

---

# Error Handling

Catch specific exceptions.

BAD

except Exception:

GOOD

except ValueError:

---

# API Documentation Requirements (OpenAPI)

All API endpoints MUST include complete OpenAPI documentation.

Documentation must be clear enough for another developer to understand how to use the API without reading the source code.

Each endpoint must include:

- clear description
- summary
- request body documentation
- response schema
- error responses
- realistic usage examples

Incomplete API documentation is not allowed.

---

# OpenAPI Examples

All request and response models must include **realistic examples**.

Examples must reflect real usage of the API and contain meaningful data.

BAD

example:
{
"name": "string"
}

GOOD

example:
{
"id": 123,
"email": "user@example.com",
"active": true,
"created_at": "2026-03-09T10:00:00Z"
}

---

# Endpoint Documentation Quality

Each endpoint must document:

Summary  
Short description of the endpoint.

Detailed description  
Explain what the endpoint does and when it should be used.

Request parameters  
All parameters must be documented.

Request body schema  
Must reference a strongly typed model.

Response schema  
Must define all returned fields.

Error responses  
Document possible error cases.

Examples  
Provide complete example requests and responses.

---

# API Consistency

All endpoints must follow consistent conventions:

- consistent naming
- consistent response format
- consistent error format
- clear versioning if applicable

---

# Code Quality

All code must:

- follow PEP8
- be readable
- avoid dynamic typing
- prioritize explicit data structures
- include meaningful docstrings

---

# Summary

This project enforces:

Strict static typing  
No use of Any  
Fully typed collections  
Explicit types everywhere  
Complete OpenAPI documentation  
Realistic API examples  
Consistent API design
solo se usara o ya sea django para el backen en produccion y sqlite para el desarrollo local nunca se mockeara la base de datos, se usara la misma tecnologia en ambos entornos para evitar problemas de compatibilidad o diferencias en el comportamiento.

- Se debe usar la ultima version de Django y python de ser necesario buscar en internet las ultimas versiones de Django y python y verificar que se estan usando las ultimas versiones de Django y python, esto ayuda a mantener el código actualizado y aprovechar las mejoras y optimizaciones que se han hecho en las ultimas versiones de Django y python, ademas de usar codigo corto y potente
  la carpeta raiz del codigo python es backend

* use Python moderno (3.12+)
* tenga tipado fuerte y explícito
* esté modularizado correctamente
* evite duplicación
* siga buenas prácticas de arquitectura
* use Django moderno (4.x–5.x) cuando aplique

---

# REGLAS GENERALES

- Siempre incluir tipos en funciones y retornos
- No usar `Any` salvo caso extremo
- Preferir claridad sobre magia
- Evitar duplicación (DRY) desde el inicio
- Separar responsabilidades
- No mezclar lógica de negocio con infraestructura
- Código listo para producción

---

# 1. TIPADO MODERNO (OBLIGATORIO)

## Usar siempre:

- `X | Y` en lugar de `Union`
- `X | None` en lugar de `Optional`
- `type` para aliases
- generics modernos (`def f[T]`)
- `Self` en métodos encadenables
- `@override` en herencia
- `TypedDict` para estructuras tipo dict
- `Unpack` para `**kwargs`

---

## Ejemplo esperado

```python
type UserId = int

class User(TypedDict):
    id: UserId
    name: str
```

---

# 2. ESTRUCTURA DEL CÓDIGO

## Separar siempre en capas

- domain → modelos y entidades
- services → lógica de negocio
- repositories → acceso a datos
- presentation → views / endpoints

---

## Ejemplo

```python
services/user_service.py
repositories/user_repository.py
views/user_view.py
```

---

# 3. EVITAR DUPLICACIÓN

## Reglas

- Si una lógica se repite 2 veces → extraer función
- Si se repite en varios módulos → crear `utils` o `service`
- No duplicar queries
- No duplicar validaciones

---

## Ejemplo

```python
def normalize_email(email: str) -> str:
    return email.strip().lower()
```

---

# 4. CONTROL DE FLUJO MODERNO

## Usar `match/case` cuando:

- haya múltiples condiciones
- se desestructuren datos
- se procesen JSON/dicts

---

## Ejemplo

```python
def process(data: dict) -> str:
    match data:
        case {"type": "user", "name": name}:
            return name
        case _:
            return "unknown"
```

---

# 5. FUNCIONES Y FIRMAS

## Reglas

- Usar `/` para parámetros posicionales
- Usar `*` para keyword-only
- Tipar todos los parámetros

---

## Ejemplo

```python
def create_user(name: str, /, *, active: bool) -> User:
    ...
```

---

# 6. USO DE CLASES

## Reglas

- Usar `@dataclass` para modelos simples
- Usar clases cuando haya estado compartido
- Usar `Self` en métodos encadenables

---

## Ejemplo

```python
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
```

---

# 7. DJANGO MODERNO

## 7.1 VIEWS ASYNC

Siempre que haya I/O:

```python
async def get_user(request):
    ...
```

---

## 7.2 ORM EXPRESIVO

Usar:

- `annotate`
- `select_related`
- `prefetch_related`
- `Subquery`
- `Exists`

Evitar lógica en Python si puede ir en DB

---

## 7.3 MODELOS

Usar:

- `JSONField`
- `db_default`
- `GeneratedField` (si aplica)

---

## 7.4 CONSTRAINTS

Definir en modelos:

```python
CheckConstraint(...)
UniqueConstraint(...)
```

No validar solo en código

---

## 7.5 STORAGE

Usar configuración moderna:

```python
STORAGES = {...}
```

---

## 7.6 ADMIN

Siempre mejorar:

- list_display
- search_fields
- list_filter

---

## 7.7 COMPOSITE PK

Usar soporte nativo cuando haya claves compuestas

---

# 8. VALIDACIONES

## Reglas

- Validar en:
  - modelos (DB)
  - services (lógica)

- No duplicar validaciones en múltiples capas

---

# 9. ERRORES

## Reglas

- No usar `except Exception` sin control
- Manejar errores específicos
- Usar múltiples excepciones si aplica

---

# 10. IMPORTS

## Reglas

- Imports explícitos
- Evitar `*`
- Agrupar por módulos
- Evitar ciclos

---

# 11. SALIDA ESPERADA DEL LLM

El código debe:

- estar completo
- ser modular
- estar tipado
- no tener duplicación
- seguir estructura clara
- listo para producción

---

# 12. CHECKLIST INTERNO DEL LLM

Antes de responder, validar:

- ¿Tiene typing completo?
- ¿Hay duplicación?
- ¿Está modularizado?
- ¿Se puede simplificar con `match`?
- ¿Se separó lógica de negocio?
- ¿Usa features modernas de Python?
- ¿Django está actualizado a prácticas modernas?

---

# 13. MODO DE GENERACIÓN

- Pensar primero en arquitectura
- Luego definir tipos
- Luego implementar lógica
- Luego organizar módulos
- Finalmente limpiar código

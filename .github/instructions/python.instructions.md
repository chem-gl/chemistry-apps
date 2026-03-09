---
applyTo: "**/*.py"
---

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
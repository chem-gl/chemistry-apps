---

## applyTo: "**/*.py"
## name: "Python Backend Guide - Django Moderno"
## description: "Guía integral para generar código tipado, modular, mantenible, alineado con Python 3.12+ y Django 6.x usando arquitectura hexagonal"

# 🧠 GUÍA INTEGRAL BACKEND (PYTHON + DJANGO MODERNO)

## 🎯 OBJETIVO

El agente debe generar código: 
    * tipado estrictamente
    * modular
    * mantenible
    * alineado con Python moderno (3.12+)
    * alineado con Django moderno (6.x)

---

# 0. VERSIONES OBLIGATORIAS

- Python: **3.12 o superior**
- Django: **6.x (última versión estable)**

Django 6 soporta Python 3.12–3.14 y elimina versiones antiguas, por lo que se debe usar siempre stack moderno. ([Django Documentation][1])

---

# 1. INTEGRACIÓN DE APP CIENTÍFICA (OBLIGATORIO)

Seguir:

.github/instructions/scientific-app-onboarding.instructions.md

Resumen:

1. estructura completa:
   - apps.py
   - definitions.py
   - types.py
   - schemas.py
   - plugin.py
   - routers.py
   - contract.py
   - tests.py

2. registrar en `ready()`

3. tipado estricto (sin Any)

4. documentación OpenAPI completa

5. registrar en settings y urls

6. validar tests + schema + check

---

# 2. ARQUITECTURA (HEXAGONAL OBLIGATORIA)

## 2.1 Arquitectura hexagonal (ports & adapters)

El agente DEBE usar:

- dominio independiente
- puertos (interfaces)
- adaptadores (implementaciones)

---

## 2.2 Capas obligatorias

- domain → entidades puras
- application/services → lógica
- ports → interfaces
- adapters → DB / API
- presentation → views

---

## 2.3 Regla clave

- dominio NO depende de Django
- Django es infraestructura

---

## 2.4 Estructura esperada

```
backend/
  apps/
    users/
      domain/
      services/
      ports/
      adapters/
      presentation/
```

---

## 2.5 Tamaño de archivos

- Ideal: **300–400 líneas**
- Mínimo: **100 líneas**
- Máximo: **600 líneas**

Reglas:

- PROHIBIDO >600 líneas
- EVITAR <100 líneas
- dividir por responsabilidad
- evitar sobre-fragmentación

---

# 3. PRINCIPIOS DE DISEÑO

## 3.1 Liskov (LSP)

- Subclases deben ser sustituibles
- No romper contratos
- No cambiar comportamiento esperado

---

## 3.2 Modularización

El sistema debe ser:

- desacoplado
- cohesivo
- reutilizable

---

## 3.3 Arquitectura en capas

Separar:

- presentación
- dominio
- infraestructura

---

## 3.4 MVC en Django

- Model → models.py
- View → views.py
- Controller → delegar en services

---

# 4. TIPADO ESTRICTO (OBLIGATORIO)

- Tipar TODO
- Prohibido `Any`
- Colecciones siempre tipadas

---

## Ejemplo

```python
def get_user(user_id: int) -> User:
    ...
```

---

## Colecciones

```python
users: list[User]
mapping: dict[str, User]
```

---

## Opcionales

```python
user: User | None
```

---

# 5. PYTHON MODERNO (3.12+)

## 5.1 Features obligatorias

- `X | Y`
- `type` alias
- generics (`def f[T]`)
- `Self`
- `@override`
- `TypedDict`
- `dataclass(slots=True)`
- `match/case`
- pattern matching estructural

---

## 5.2 Ejemplo

```python
type UserId = int

class User(TypedDict):
    id: UserId
    name: str
```

---

# 6. DJANGO MODERNO (6.x)

## 6.1 Async-first

```python
async def get_user(request):
    ...
```

---

## 6.2 ORM avanzado

Usar:

- `select_related`
- `prefetch_related`
- `annotate`
- `Subquery`
- `Exists`

---

## 6.3 Features modernas clave

Django 6 introduce:

- background tasks nativos
- Content Security Policy (CSP)
- template partials
- AsyncPaginator
- mejoras ORM y seguridad ([Django.wiki][2])

---

## 6.4 Modelos

- `JSONField`
- `GeneratedField`
- `db_default`

---

## 6.5 Constraints

```python
UniqueConstraint(...)
CheckConstraint(...)
```

---

## 6.6 Background tasks

```python
from django.core.tasks import background

@background
def task():
    ...
```

---

## 6.7 Admin

- list_display
- search_fields
- list_filter

---

## 6.8 Storage moderno

```python
STORAGES = {...}
```

---

# 7. BASE DE DATOS

- Producción → Django ORM
- Desarrollo → SQLite
- MISMA tecnología (sin mocks)

---

# 8. VALIDACIONES

- DB → constraints
- services → lógica

No duplicar

---

# 9. FUNCIONES

- Máx 20–30 líneas
- una responsabilidad
- tipadas

---

# 10. CONTROL DE FLUJO

```python
def process(data: dict) -> str:
    match data:
        case {"type": "user", "name": name}:
            return name
        case _:
            return "unknown"
```

---

# 11. ERRORES

- usar excepciones específicas
- PROHIBIDO `except Exception`

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

- Pensar primero en arquitectura (hexagonal)
- Definir puertos (interfaces)
- Definir tipos
- Implementar lógica
- Crear adaptadores
- Organizar módulos
- Limpiar código

---

# 14. OPENAPI (OBLIGATORIO)

Cada endpoint debe incluir:

- summary
- descripción
- request schema
- response schema
- errores
- ejemplos reales

---

# 15. CONSISTENCIA

- naming consistente
- contratos consistentes
- estructuras repetibles

---

# 16. LIMPIEZA

- eliminar duplicación
- eliminar código muerto
- simplificar lógica

---

# 17. ANTI-PATTERNS y MALAS PRÁCTICAS

- `Any`
- lógica en views
- duplicación
- clases gigantes
- funciones largas
- acoplamiento fuerte

# 18. Mejor refactorizar a servicios, usar puertos/adapters, dividir responsabilidades. por ejemplo

Uso de tipos

- No uses `Any`.
  Usa tipos concretos (`str`, `int`, etc.), uniones (`X | Y`) o genéricos con `TypeVar`.

- No uses `object` como tipo genérico.
  Usa `Protocol` si necesitas definir comportamiento o `TypeVar` si el valor es genérico.

---

Colecciones tipadas

- No uses `list` sin parametrizar.
  Usa `list[T]`.

- No uses `dict` sin parametrizar.
  Usa `dict[K, V]` o define un `TypedDict` o una clase.

- No uses `tuple` sin definir su estructura.
  Usa `tuple[T1, T2]` o `tuple[T, ...]`.

- No uses `set` sin tipo.
  Usa `set[T]`.

---

Tipos funcionales y clases

- No uses `Callable` sin especificar firma.
  Usa `Callable[[Args...], ReturnType]`.

- No uses `Type` sin parametrizar.
  Usa `type[T]`.

---

Diseño de tipos

- No uses `Union` con demasiados tipos no relacionados.
  Modela los datos con clases, `Protocol` o separa la lógica.

- No uses estructuras ambiguas como `dict` genérico para datos estructurados.
  Usa `TypedDict`, `dataclass` o clases.

---

Genéricos

- No escribas funciones genéricas sin tipado.
  Usa `TypeVar` para preservar el tipo de entrada y salida.

---

Validación y conversiones

- No abuses de `cast`.
  Asegura tipos correctos desde el origen o valida con `isinstance`.

---

    Manejo de errores de tipo

- No uses `# type: ignore` para silenciar errores.
  Corrige el tipo o refactoriza el código.

---

Reglas de calidad (Sonar y similares)

- No uses `NOSONAR`, desactivación de reglas, ni supresiones para ocultar problemas de tipado.

- No ocultes errores de análisis estático.
  Los errores deben corregirse, no silenciarse.

---

Regla general

Si necesitas usar `Any`, `type: ignore` o suprimir reglas del linter, se debe asumir que el diseño de tipos es incorrecto y debe refactorizarse.

# ⚡ RESULTADO ESPERADO

Código:

- moderno (Python 3.12+, Django 6)
- arquitectura hexagonal
- uso de puertos y adaptadores
- completamente tipado
- modular sin sobre-fragmentación
- limpio
- listo para producción
- alineado con mejores prácticas actuales

[1]: https://django.readthedocs.io/en/latest/releases/6.0.html?utm_source=chatgpt.com "Django 6.0 release notes — Django 6.1.dev20260311170544 documentation"
[2]: https://django.wiki/articles/django-6-new-features/?utm_source=chatgpt.com "What's New in Django 6.0 Major Features and Changes - Django.wiki"

Si el uso de mónadas o abstracciones funcionales reduce la legibilidad o complica el código innecesariamente, se debe preferir una solución más simple.
Todas las reglas pueden ser ignoradas si se justifica claramente que hacerlo mejora la claridad o la mantenibilidad del código en ese caso específico, pero no se deben ignorar sin una razón de peso y una justificación clara bien comentada en el lugar del código donde se ignore la regla, explicando por qué se decidió ignorar esa regla en ese caso específico, y cómo esa decisión mejora la claridad o la mantenibilidad del código en ese contexto particular.

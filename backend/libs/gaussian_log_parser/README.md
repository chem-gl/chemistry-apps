# Librería Gaussian Log Parser

Parser profesional para archivos de logs de Gaussian (.log). Extrae información de cálculos computacionales de forma estructurada, con tipos estrictos y sin dependencias externas.

## 📋 Características

- ✅ **Tipado estricto**: Sin `Any`, con TypedDicts y dataclasses
- ✅ **Sin dependencias externas**: Solo stdlib de Python
- ✅ **Extrae múltiples cálculos**: Maneja logs con varias ejecuciones
- ✅ **Atributos configurables**: Arquitectura extensible
- ✅ **Tests completos**: Cobertura con unittest
- ✅ **Manejo de errores**: Validaciones y logging claro

## 🎯 Información que extrae

Para cada ejecución Gaussian, la librería extrae:

- **Identidad**: Archivo checkpoint, comando, título del cálculo
- **Estructura molecular**: Carga, multiplicidad
- **Convergencia**: Energía SCF, terminación normal
- **Frecuencias**: Cantidad de frecuencias imaginarias, valores
- **Energías**: ZPE, entalpías térmicas, energías libres
- **Parámetros**: Temperatura, tipo de cálculo (opt, freq, etc.)

## 🚀 Instalación

Esta librería está incluida en `backend/libs/gaussian_log_parser/`. No requiere instalación adicional.

## 💻 Uso básico

### Parsear un archivo

```python
from libs.gaussian_log_parser import GaussianLogParser

parser = GaussianLogParser()
result = parser.parse_file("ruta/al/archivo.log")

# Verificar si el parseo fue exitoso
if result.parse_successful:
    print(f"Se encontraron {result.execution_count} ejecuciones")

    # Acceder a la primera ejecución
    execution = result.first_execution()
    print(f"Checkpoint: {execution.checkpoint_file}")
    print(f"Carga: {execution.charge}")
    print(f"Multiplicidad: {execution.multiplicity}")
    print(f"Energía SCF: {execution.scf_energy}")
else:
    print("Errores durante el parseo:")
    for error in result.errors:
        print(f"  - {error}")
```

### Pasar texto directamente o blobs

```python
from libs.gaussian_log_parser import GaussianLogParser

parser = GaussianLogParser()

# 1) Texto directo (str)
content = """
 Initial command:
 /path/to/gaussian
 %chk=test.chk
 ...
"""

result_from_text = parser.parse_content(content)

# 2) Texto directo usando parse_blob (también acepta str)
result_from_text_blob = parser.parse_blob(content)

# 3) Blob en bytes (caso común en APIs y colas)
blob_data = content.encode("utf-8")
result_from_bytes = parser.parse_blob(blob_data)

# 4) Otros formatos binarios soportados
result_from_memoryview = parser.parse_blob(memoryview(blob_data))
result_from_bytearray = parser.parse_blob(bytearray(blob_data))
```

### Ejemplo típico cuando el archivo llega por upload

```python
from libs.gaussian_log_parser import GaussianLogParser

parser = GaussianLogParser()

# En muchos frameworks, uploaded_file.read() devuelve bytes
uploaded_bytes = uploaded_file.read()
result = parser.parse_blob(uploaded_bytes)

if result.parse_successful:
    execution = result.first_execution()
    print(execution.checkpoint_file)
else:
    print(result.errors)
```

### Acceder a todas las ejecuciones

```python
for i, execution in enumerate(result.executions):
    print(f"\nEjecución {i + 1}:")
    print(f"  Archivo: {execution.checkpoint_file}")
    print(f"  Es opt+freq: {execution.is_opt_freq}")
    print(f"  Tiene frecuencias negativas: {execution.has_imaginary_frequencies()}")
    print(f"  Frecuencias imaginarias: {execution.negative_frequencies}")
    print(f"  Terminó normalmente: {execution.normal_termination}")
```

### Convertir a diccionario (serialización)

```python
execution = result.first_execution()
data = execution.to_dict()

# Ahora se puede serializar a JSON, etc.
import json
json_str = json.dumps(data, default=str)
```

## 🏗️ Estructura de la librería

```text
gaussian_log_parser/
├── __init__.py                # Exportaciones principales
├── types.py                   # TypedDicts para contratos
├── models.py                  # Dataclasses (GaussianExecution, Result)
├── parsers.py                 # Parser principal
├── attributes/
│   ├── __init__.py
│   ├── base.py               # Clase abstracta GaussianAttribute
│   └── gaussian_attributes.py # Extractores específicos
├── tests.py                   # Tests unitarios
└── README.md                  # Este archivo
```

## 🧪 Ejecutar tests

Desde la carpeta `backend/`:

```bash
# Con unittest
python -m unittest libs.gaussian_log_parser.tests -v

# Con pytest (si está instalado)
python -m pytest libs/gaussian_log_parser/tests.py -v

# Con Django
python manage.py test libs.gaussian_log_parser.tests
```

## 📦 Modelo de datos

### GaussianExecution

Representa un cálculo Gaussian:

```python
@dataclass
class GaussianExecution:
    checkpoint_file: str           # %chk=
    command: str                   # Initial command
    job_title: str                 # Título del cálculo
    charge: int                    # Carga total
    multiplicity: int              # Multiplicidad de espín
    negative_frequencies: int      # Cantidad de freq. imaginarias
    imaginary_frequency: float     # Valor de freq. imaginaria
    zero_point_energy: float       # ZPE en Hartree
    thermal_enthalpies: float      # H_termo en Hartree
    free_energies: float          # G en Hartree
    temperature: float             # Temperatura en Kelvin
    is_opt_freq: bool             # Es opt + freq
    scf_energy: float             # Energía SCF en Hartree
    is_optimization: bool         # Es optimización
    normal_termination: bool      # Terminó correctamente
```

### GaussianLogParserResult

Resultado del parseo:

```python
@dataclass
class GaussianLogParserResult:
    executions: list[GaussianExecution]  # Ejecuciones encontradas
    parse_successful: bool               # Sin errores
    errors: list[str]                    # Mensajes de error
```

## 🔧 Extensión: Agregar nuevos atributos

Para extraer un atributo adicional:

1. Crear una clase que herede de `GaussianAttribute`
2. Implementar `revision_condition()` y `extract_value()`
3. Registrarla en `GaussianLogParser.__init__()`

Ejemplo:

```python
from libs.gaussian_log_parser.attributes.base import GaussianAttribute

class MiNuevoAtributo(GaussianAttribute):
    def __init__(self):
        super().__init__("Mi Atributo")

    def revision_condition(self, line: str) -> bool:
        return "palabra_clave" in line

    def extract_value(self, line: str) -> float:
        return self.extract_float(line)

# Registrar en parsers.py en __init__:
self._attributes.append(MiNuevoAtributo())
```

## 📝 Notas de diseño

- **Sin dependencias externas**: Usa solo stdlib
- **Tipado estricto**: Cumple con `python.instructions.md`
- **Tolerante a errores**: Ignora caracteres inválidos (encoding)
- **Reutilizable**: Diseño en capas para extraer a paquete aparte
- **Testeable**: Lógica separada de I/O

## 📄 Licencia

Parte del proyecto chemistry-apps.

## 👥 Contribuciones

Para agregar nuevos atributos o parsers, mantener el patrón:

1. Tipado explícito
2. Encabezado con propósito y uso
3. Tests unitarios
4. Documentación en docstrings españoles

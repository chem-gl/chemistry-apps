# ck_test - Librería de Cálculo TST

Librería de cálculo de Teoría de Estado de Transición (Transition State Theory - TST) para determinar constantes de velocidad en reacciones químicas.

## Descripción

La librería `ck_test` proporciona herramientas para calcular coeficientes de velocidad usando la teoría de estado de transición. Implementa integración numérica por cuadratura de Gauss-Legendre con 40 puntos para máxima precisión.

## Características

- **Tipado estricto**: Todos los parámetros y retornos están fuertemente tipados
- **Constantes CODATA**: Utiliza estándares físicos internacionales
- **Manejo robusto de errores**: Validación de entrada y captura de excepciones
- **Integración gaussiana**: 40 puntos de cuadratura para precisión
- **Pruebas unitarias**: Cobertura completa de casos de uso

## Instalación

La librería está integrada en el proyecto. Para usarla:

```python
from libs.ck_test import TST, TSTInputParams, TSTResult
```

## Uso Básico

### Cálculo simple

```python
from libs.ck_test import TST

# Crear calculador con parámetros
calculator = TST(
    delta_zpe=-8.2,          # Diferencia ZPE (kcal/mol)
    barrier_zpe=3.5,         # Barrera ZPE (kcal/mol)
    frequency=625,           # Frecuencia imaginaria (cm^-1)
    temperature=298.15       # Temperatura (K)
)

# Obtener resultado
result = calculator.result
if result.success:
    print(f"G = {result.g}")
    print(result)
```

### Parámetros dinámicos

```python
from libs.ck_test import TST

calculator = TST()

# Primer cálculo
result1 = calculator.set_parameters(
    delta_zpe=-8.2,
    barrier_zpe=3.5,
    frequency=625,
    temperature=298.15
)

# Segundo cálculo con nuevos parámetros
result2 = calculator.set_parameters(
    delta_zpe=-5.0,
    barrier_zpe=2.0,
    frequency=500,
    temperature=300.0
)
```

## Parámetros

- **delta_zpe** (float): Diferencia de energía de punto cero en kcal/mol
- **barrier_zpe** (float): Barrera energética de punto cero en kcal/mol
- **frequency** (float): Frecuencia imaginaria en cm⁻¹ (sin signo negativo)
- **temperature** (float): Temperatura en Kelvin

## Resultado

El resultado contiene:

- **alpha_1**: Parámetro alfa 1 (adimensional)
- **alpha_2**: Parámetro alfa 2 (adimensional)
- **u**: Factor U adimensional
- **g**: Coeficiente de velocidad resultado
- **success**: Booleano indicando éxito del cálculo
- **error_message**: Mensaje de error si falla

## Constantes Físicas

La librería utiliza constantes CODATA:

- Número de Avogadro: 6.0221367×10²³
- Constante de Planck: 6.6260755×10⁻³⁴ J·s
- Velocidad de luz: 2.9979246×10¹⁰ cm/s
- Constante de Boltzmann: 1.380658×10⁻²³ J/K
- Conversión cal→J: 4184.0

## Pruebas

Para ejecutar las pruebas unitarias:

```bash
cd backend
python -m pytest libs/ck_test/tests.py -v
```

## Integración con Apps

Esta librería puede ser integrada como plugin en nuevas apps científicas siguiendo el manual: `.github/instructions/scientific-app-onboarding.instructions.md`

## Referencias

- Wigner transition state theory
- Gauss-Legendre quadrature integration (40 points)
- CODATA physical constants

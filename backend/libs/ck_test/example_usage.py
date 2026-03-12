"""
# ck_test/example_usage.py

Ejemplos de uso de la librería CK_TEST.
Demuestra cómo usar el calculador TST en diferentes escenarios.

Uso:
    cd backend
    python -c "from libs.ck_test.example_usage import *; ejemplo_basico()"
"""

from .calculators import TST
from .models import TSTInputParams


def ejemplo_basico() -> None:
    """Ejemplo básico: cálculo simple con parámetros conocidos."""
    print("=" * 60)
    print("EJEMPLO 1: Cálculo Básico")
    print("=" * 60)

    # Crear calculador con parámetros del ejemplo original
    calculator = TST(
        delta_zpe=-8.2,  # Diferencia ZPE en kcal/mol
        barrier_zpe=3.5,  # Barrera ZPE en kcal/mol
        frequency=625,  # Frecuencia imaginaria en cm^-1
        temperature=298.15,  # Temperatura en Kelvin
    )

    result = calculator.result
    if result and result.success:
        print("✓ Cálculo exitoso")
        print(f"  U (factor adimensional): {result.u:.4f}")
        print(f"  Alpha 1: {result.alpha_1:.4f}")
        print(f"  Alpha 2: {result.alpha_2:.4f}")
        print(f"  G (coeficiente): {result.g:.4f}")
        print(result)
    else:
        print(f"✗ Error: {result.error_message if result else 'Unknown'}")


def ejemplo_dinamico() -> None:
    """Ejemplo 2: Usar el método set_parameters para cálculos múltiples."""
    print("=" * 60)
    print("EJEMPLO 2: Cálculos Secuenciales con set_parameters()")
    print("=" * 60)

    calculator = TST()

    # Primera reacción
    print("\nCálculo 1: Sistema A")
    result1 = calculator.set_parameters(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15,
    )
    print(f"  G = {result1.g:.4f}")

    # Segunda reacción con diferentes parámetros
    print("\nCálculo 2: Sistema B")
    result2 = calculator.set_parameters(
        delta_zpe=-5.0,
        barrier_zpe=2.0,
        frequency=500,
        temperature=300.0,
    )
    print(f"  G = {result2.g:.4f}")

    # Tercera reacción
    print("\nCálculo 3: Sistema C (temperatura diferente)")
    result3 = calculator.set_parameters(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=500.0,  # Mayor temperatura
    )
    print(f"  G = {result3.g:.4f}")


def ejemplo_estudio_temperatura() -> None:
    """Ejemplo 3: Estudio de sensibilidad a temperatura."""
    print("=" * 60)
    print("EJEMPLO 3: Sensibilidad a Temperatura")
    print("=" * 60)

    temperatures = [200.0, 298.15, 400.0, 500.0]
    print("\nVariando temperatura para la misma reacción:")
    print("{:>15} | {:>12}".format("Temperatura (K)", "G"))
    print("-" * 30)

    for temp in temperatures:
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=temp,
        )
        result = calculator.result
        if result:
            print(f"{temp:>15.2f} | {result.g:>12.6f}")


def ejemplo_manejo_errores() -> None:
    """Ejemplo 4: Manejo de errores y validación."""
    print("=" * 60)
    print("EJEMPLO 4: Manejo de Errores")
    print("=" * 60)

    # Caso 1: Frecuencia negativa (error)
    print("\nCaso 1: Frecuencia negativa")
    calculator = TST()
    result = calculator.set_parameters(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=-625,  # ¡Negativa!
        temperature=298.15,
    )
    print(f"  Success: {result.success}")
    print(f"  Error: {result.error_message}")

    # Caso 2: Parámetros válidos
    print("\nCaso 2: Parámetros válidos")
    result = calculator.set_parameters(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15,
    )
    print(f"  Success: {result.success}")
    print(f"  G: {result.g:.4f}")


def ejemplo_tipos_estrictos() -> None:
    """Ejemplo 5: Uso de tipos con TypedDict y modelos."""
    print("=" * 60)
    print("EJEMPLO 5: Uso de Tipos Estrictos")
    print("=" * 60)

    # Crear parámetros explícitamente tipados
    params = TSTInputParams(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15,
    )

    print("\nParámetros creados:")
    print(f"  delta_zpe: {params.delta_zpe} kcal/mol")
    print(f"  barrier_zpe: {params.barrier_zpe} kcal/mol")
    print(f"  frequency: {params.frequency} cm^-1")
    print(f"  temperature: {params.temperature} K")

    # Usar los parámetros
    calculator = TST()
    result = calculator.set_parameters(**vars(params))

    print("\nResultado:")
    print(f"  Success: {result.success}")
    print(f"  G: {result.g:.4f}")

    # Convertir resultado a diccionario
    result_dict = result.to_dict()
    print("\nResultado como diccionario:")
    for key, value in result_dict.items():
        print(f"  {key}: {value}")


def main() -> None:
    """Ejecuta todos los ejemplos."""
    ejemplo_basico()
    ejemplo_dinamico()
    ejemplo_estudio_temperatura()
    ejemplo_manejo_errores()
    ejemplo_tipos_estrictos()

    print("\n" + "=" * 60)
    print("Todos los ejemplos completados ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()

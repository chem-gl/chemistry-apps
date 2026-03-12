"""
# gaussian_log_parser/attributes/gaussian_attributes.py

Implementaciones específicas de extractores de atributos para logs Gaussian.
Cada clase hereda de GaussianAttribute e implementa la lógica para extraer
un atributo específico del log de Gaussian.

Uso:
    from libs.gaussian_log_parser.attributes import CheckpointFileAttribute
    attr = CheckpointFileAttribute()
    if attr.revision_condition(line):
        attr.process(line)
"""

from .base import GaussianAttribute


class CheckpointFileAttribute(GaussianAttribute):
    """Extrae el archivo checkpoint (%chk=...)."""

    def __init__(self) -> None:
        super().__init__("Checkpoint File")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con %chk=."""
        return "%chk=" in line

    def extract_value(self, line: str) -> str:
        """Extrae el nombre del archivo después de %chk=."""
        return self.extract_string(line, separator="=")


class CommandAttribute(GaussianAttribute):
    """Extrae el comando de ejecución inicial."""

    def __init__(self) -> None:
        super().__init__("Initial Command")
        self._await_command_line = False

    def revision_condition(self, line: str) -> bool:
        """Detecta el inicio y luego consume la siguiente línea no vacía como comando."""
        if "Initial command:" in line:
            self._await_command_line = True
            return False

        if self._await_command_line and line.strip():
            return True

        return False

    def extract_value(self, line: str) -> str:
        """Extrae el comando completo desde la línea siguiente al marcador."""
        self._await_command_line = False
        return line.strip()

    def reset(self) -> None:
        """Reinicia estado interno del atributo."""
        super().reset()
        self._await_command_line = False


class JobTitleAttribute(GaussianAttribute):
    """Extrae el título del trabajo."""

    def __init__(self) -> None:
        super().__init__("Job Title")
        self._separator_count = 0

    def revision_condition(self, line: str) -> bool:
        """Detecta el segundo grupo de separadores (---) que marca el título."""
        if "---" in line and len(line.strip()) < 50:
            self._separator_count += 1
            # Retornar true cuando vemos el segundo grupo de separadores
            if self._separator_count == 2:
                return True
        return False

    def extract_value(self, line: str) -> str:
        """Retorna el contenido entre separadores."""
        return line.strip().replace("-", "").strip()

    def reset(self) -> None:
        """Reinicia estado interno del atributo."""
        super().reset()
        self._separator_count = 0


class ChargeMultiplicityAttribute(GaussianAttribute):
    """Extrae carga y multiplicidad (Charge = X Multiplicity = Y)."""

    def __init__(self) -> None:
        super().__init__("Charge and Multiplicity")
        self.charge: int = 0
        self.multiplicity: int = 1

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con 'Charge' y 'Multiplicity'."""
        return "Charge" in line and "Multiplicity" in line

    def extract_value(self, line: str) -> str:
        """Extrae carga y multiplicidad."""
        # Formato típico: "Charge =  1 Multiplicity = 2"
        parts = line.split("=")
        if len(parts) >= 3:
            try:
                self.charge = int(parts[1].split()[0])
                self.multiplicity = int(parts[2].split()[0])
                return f"Charge={self.charge}, Multiplicity={self.multiplicity}"
            except (ValueError, IndexError):
                pass
        return ""

    def reset(self) -> None:
        """Reinicia estado interno del atributo."""
        super().reset()
        self.charge = 0
        self.multiplicity = 1


class NegativeFrequenciesAttribute(GaussianAttribute):
    """Extrae cantidad de frecuencias imaginarias."""

    def __init__(self) -> None:
        super().__init__("Negative Frequencies Count")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con 'imaginary frequencies' sin '1 imaginary'."""
        return (
            "imaginary frequencies" in line
            and "1 imaginary frequencies" not in line
            and "1" not in line.split()[0]
        )

    def extract_value(self, line: str) -> float:
        """Extrae el número de frecuencias imaginarias."""
        float_val = self.extract_float(line)
        return float_val if not (float_val != float_val) else 0.0  # NaN check


class ImaginaryFrequencyAttribute(GaussianAttribute):
    """Extrae la primera frecuencia imaginaria."""

    def __init__(self) -> None:
        super().__init__("Imaginary Frequency")
        self.has_imaginary = False

    def revision_condition(self, line: str) -> bool:
        """
        Detecta si hay frecuencias imaginarias y luego busca el valor.
        La lógica es: primero marcar que existen, luego buscar en 'Frequencies --'
        """
        if "1 imaginary frequencies (negative Signs)" in line:
            self.has_imaginary = True

        return self.has_imaginary and "Frequencies --" in line

    def extract_value(self, line: str) -> float:
        """Extrae la primera frecuencia (imaginaria)."""
        floats = self.extract_floats(line)
        return floats[0] if floats else float("nan")

    def reset(self) -> None:
        """Reinicia estado interno del atributo."""
        super().reset()
        self.has_imaginary = False


class ZeroPointEnergyAttribute(GaussianAttribute):
    """Extrae la energía de punto cero."""

    def __init__(self) -> None:
        super().__init__("Zero-Point Energy")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con energía de punto cero."""
        return "Sum of electronic and zero-point Energies=" in line

    def extract_value(self, line: str) -> float:
        """Extrae la energía de punto cero."""
        return self.extract_float(line)


class ThermalEnthalpiesAttribute(GaussianAttribute):
    """Extrae las entalpías térmicas."""

    def __init__(self) -> None:
        super().__init__("Thermal Enthalpies")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con entalpías térmicas."""
        return "Sum of electronic and thermal Enthalpies=" in line

    def extract_value(self, line: str) -> float:
        """Extrae las entalpías térmicas."""
        return self.extract_float(line)


class ThermalFreeEnergiesAttribute(GaussianAttribute):
    """Extrae las energías libres térmicas."""

    def __init__(self) -> None:
        super().__init__("Thermal Free Energies")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con energías libres térmicas."""
        return "Sum of electronic and thermal Free Energies=" in line

    def extract_value(self, line: str) -> float:
        """Extrae las energías libres térmicas."""
        return self.extract_float(line)


class TemperatureAttribute(GaussianAttribute):
    """Extrae la temperatura del cálculo."""

    def __init__(self) -> None:
        super().__init__("Temperature")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con temperatura."""
        return "Temperature" in line and "Kelvin" in line

    def extract_value(self, line: str) -> float:
        """Extrae la temperatura."""
        return self.extract_float(line)


class IsOptFreqAttribute(GaussianAttribute):
    """Detecta si el cálculo es opt+freq."""

    def __init__(self) -> None:
        super().__init__("Is Opt Freq")

    def revision_condition(self, line: str) -> bool:
        """Detecta si la línea contiene opt y freq."""
        return "#p" in line and "opt" in line.lower() and "freq" in line.lower()

    def extract_value(self, line: str) -> str:
        """Retorna 'true' si es opt+freq."""
        return "true"


class SCFEnergyAttribute(GaussianAttribute):
    """Extrae la energía SCF final."""

    def __init__(self) -> None:
        super().__init__("SCF Energy")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea con energía SCF."""
        return "SCF Done:" in line

    def extract_value(self, line: str) -> float:
        """Extrae la energía SCF (el primer float después de valores numéricos)."""
        # Buscar patrón: "SCF Done: E(...) = -542.456789"
        # Extraer uno de los floats más grandes (la energía está antes de los ciclos)
        floats = self.extract_floats(line)
        # La energía es generalmente el primer float grande (negativo)
        if floats:
            # Retornar el primero que sea negativo o el primero si todos son positivos
            for f in floats:
                if f < -500:  # Energías típicas en Hartree
                    return f
            return floats[0]
        return float("nan")


class NormalTerminationAttribute(GaussianAttribute):
    """Detecta si el cálculo terminó normalmente."""

    def __init__(self) -> None:
        super().__init__("Normal Termination")

    def revision_condition(self, line: str) -> bool:
        """Detecta línea de terminación normal."""
        return "Normal termination of Gaussian" in line

    def extract_value(self, line: str) -> str:
        """Retorna 'true' si tuvo terminación normal."""
        return "true"

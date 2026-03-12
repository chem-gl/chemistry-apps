"""
# gaussian_log_parser/attributes/base.py

Clase abstracta base para extractores de atributos de logs Gaussian.
Define la interfaz que deben cumplir todos los atributos específicos.

Uso:
    from libs.gaussian_log_parser.attributes.base import GaussianAttribute

    class MiAtributo(GaussianAttribute):
        def revision_condition(self, line: str) -> bool:
            return "palabra_clave" in line

        def extract_value(self, line: str) -> float | str:
            return self.extract_float(line)
"""

import re
from abc import ABC, abstractmethod


class GaussianAttribute(ABC):
    """
    Clase abstracta base para extractores de atributos de logs Gaussian.

    Define la interfaz que deben cumplir los atributos para:
    - Detectar líneas relevantes en el log
    - Extraer valores numéricos o strings
    - Gestionar estado de búsqueda

    Atributos:
        _value: Valor extraído del log
        _found: Si se encontró el atributo
        _active: Si aún se está buscando
        _line_number: Línea donde se encontró
    """

    REGEX_FLOAT = r"([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"

    def __init__(self, name: str = "") -> None:
        """
        Inicializa el atributo.

        Args:
            name: Nombre descriptivo del atributo
        """
        self.name = name
        self._value: float | str | None = None
        self._found: bool = False
        self._active: bool = True
        self._line_number: int = 0

    @abstractmethod
    def revision_condition(self, line: str) -> bool:
        """
        Define si esta línea contiene el atributo que se busca.

        Args:
            line: Línea del log a revisar

        Returns:
            True si la línea contiene el atributo, False en otro caso
        """
        pass

    @abstractmethod
    def extract_value(self, line: str) -> float | str:
        """
        Extrae el valor específico de la línea.

        Args:
            line: Línea del log

        Returns:
            Valor extraído (float o str)
        """
        pass

    def extract_float(self, line: str) -> float:
        """
        Extrae el primer número flotante de la línea.

        Args:
            line: Línea del log

        Returns:
            Primer número encontrado o NaN si no hay
        """
        match = re.search(self.REGEX_FLOAT, line)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                return float("nan")
        return float("nan")

    def extract_floats(self, line: str) -> list[float]:
        """
        Extrae todos los números flotantes de la línea.

        Args:
            line: Línea del log

        Returns:
            Lista de números encontrados
        """
        matches = re.findall(self.REGEX_FLOAT, line)
        floats: list[float] = []
        for match in matches:
            try:
                floats.append(float(match))
            except ValueError:
                pass
        return floats

    def extract_string(self, line: str, separator: str = "=") -> str:
        """
        Extrae un string después de un separador.

        Args:
            line: Línea del log
            separator: Carácter separador (por defecto "=")

        Returns:
            String extraído
        """
        if separator in line:
            parts = line.split(separator)
            return parts[-1].strip() if len(parts) > 1 else ""
        return ""

    def process(self, line: str) -> bool:
        """
        Procesa una línea del log.
        Si cumple la condición de revisión, extrae el valor y desactiva la búsqueda.

        Args:
            line: Línea a procesar

        Returns:
            True si se extrajo un valor, False en otro caso
        """
        if not self._active or self._found:
            return False

        if self.revision_condition(line):
            try:
                self._value = self.extract_value(line)
                self._found = True
                self._active = False
                return True
            except Exception:
                return False

        return False

    def reset(self) -> None:
        """Reinicia el estado interno del atributo para una nueva ejecución."""
        self._value = None
        self._found = False
        self._active = True
        self._line_number = 0

    def set_line_number(self, line_number: int) -> None:
        """Establece el número de línea."""
        self._line_number = line_number

    @property
    def value(self) -> float | str | None:
        """Retorna el valor extraído."""
        return self._value

    @property
    def found(self) -> bool:
        """Retorna si se encontró el atributo."""
        return self._found

    @property
    def active(self) -> bool:
        """Retorna si aún se está buscando."""
        return self._active

    def __str__(self) -> str:
        """Representación en string del atributo."""
        if self._found:
            return f"{self.name}: {self._value}"
        return ""

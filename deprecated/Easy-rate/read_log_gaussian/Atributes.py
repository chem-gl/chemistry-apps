from enum import Enum
from pathlib import Path
from typing import List, Optional

Path(__file__).resolve()

try:
    from Atributo import *  # NOSONAR
except ImportError:
    from read_log_gaussian.Atributo import *  # NOSONAR

class ChkPointFile(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Value :str =""

    def revision_condition(self, line: str, actual: object =None) -> bool:
        if("%chk=" in line):
            return True
        return False
    
    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = line.split("=")[1]
        self._Active=False
        self._Found =True
    
    def __str__(self):
        if(self._Found):
            return "ChkPoint File : " + self._Value
        else:
            return ""

class MultipleFrecuenciaNegativa(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        # Coincide con líneas tipo: " ... imaginary frequencies (N): ..."
        return ("imaginary frequencies" in line) and ("1 imaginary frequencies" not in line)

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        # Toma el primer número entero que aparezca en la línea como conteo
        nums = self.numbers_extract(line)
        self._Value = int(nums[0]) if nums else 0
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Number of negative frequencies: {self._Value}" if self._Found else ""

class FrecuenciaNegativa(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self.Contiene: bool = False

    def revision_condition(self, line: str, actual: object = None) -> bool:
        # FSM simple: primero ve si hubo una línea anunciando 1 imaginaria;
        # luego espera la línea "Frequencies --" para leer el valor.
        self.Contiene = ("1 imaginary frequencies" in line) or self.Contiene
        return (self.Contiene and not self._Found) and ("Frequencies --" in line)

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)  # frecuencia (cm-1, suele ser negativa)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Imaginary frequency: {self._Value}" if self._Found else ""


class ZeroPointEnergies(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Sum of electronic and zero-point Energies=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Sum of electronic and zero-point Energies: {self._Value}" if self._Found else ""

class ThermalEnthalpies(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Sum of electronic and thermal Enthalpies=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Sum of electronic and thermal Enthalpies: {self._Value}" if self._Found else ""

class ThermalFreeEnergies(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Sum of electronic and thermal Free Energies=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Sum of electronic and thermal Free Energies: {self._Value}" if self._Found else ""

class Temperature(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Temperature " in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = float(self.num_extract(line=line))
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Temperature: {self._Value} K" if self._Found else ""

    @property
    def incelsius(self) -> float:
        try:
            return float(self._Value) - 273.15
        except Exception:
            return float('nan')


class NormalTermination(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Found = False
        self._Value = False

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Normal termination of Gaussian" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = True
        self._Active = False
        self._Found = True

    def __str__(self):
        return "" if self._Value else "Error termination"
        
    
class PasoVerificado(Enum):
    No = 0
    Anterior = 1
    Siguiente = 2


class Comando(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Value = ""
        self.__actual: PasoVerificado = PasoVerificado.No
        self.__ValueTemp: str = ""

    def revision_condition(self, line: str, actual: object = None) -> bool:
        if self.__actual == PasoVerificado.No and " ---------------" in line:
            self.__actual = PasoVerificado.Anterior
            return False
        if self.__actual == PasoVerificado.Anterior:
            if "#p" in line:
                self.__actual = PasoVerificado.Siguiente
                return True
            else:
                self.__actual = PasoVerificado.No
                return False
        if self.__actual == PasoVerificado.Siguiente:
            if " ---------------" in line:
                self._Value = self.__ValueTemp
                self._Found = True
                self._Active = False
                return False
            else:
                self.__actual = PasoVerificado.No
                self.__ValueTemp = ""
                return False
        return False

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self.__ValueTemp = line

    def __str__(self):
        return f"comand: {self._Value}" if self._Found else ""

        
class IsAnOptFreq(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
    def revision_condition(self, line: str, actual: object =None) -> bool:
        if("opt freq" in line):
            return True
        return False
    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value:bool = True
        self._Active=False
        self._Found =True
    
    def __str__(self):
        if(self._Found):
            return "OPT Freq ?: "+str(self._Value)
        else:
            return ""

class SCF(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "SCF Done:" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        # Más robusto: agarra el primer número de la línea (suele ser la energía)
        nums = self.numbers_extract(line)
        self._Value = nums[0] if nums else None
        self._Active = True
        self._Found = True

    def __str__(self):
        return f"SCF Energy: {self._Value}" if self._Found else ""
        
class ISThermo(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
    def revision_condition(self, line: str, actual: object =None) -> bool:
        if("Thermochemistry" in line):
            return True
        return False
    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value:bool = True
        self._Active=False
        self._Found =True
    
    def __str__(self):
        if(self._Found):
            return "IS Thermo: "+str(self._Value)
        else:
            return ""
            
class ZeroPointCorrection(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Zero-point correction=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Zero-point correction= {self._Value}" if self._Found else ""

class ThermalCorrectionToEnergy(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Thermal correction to Energy=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Thermal correction to Energy= {self._Value}" if self._Found else ""

class ThermalcorrectiontoEnthalpy(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return "Thermal correction to Enthalpy=" in line

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active = False
        self._Found = True

    def __str__(self):
        return f"Thermal correction to Enthalpy= {self._Value}" if self._Found else ""

class JobTitle(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Value = ""
        self.__actual = PasoVerificado.No
        self.__ValueTemp: str = ""

    def revision_condition(self, line: str, actual: object = None) -> bool:
        if self.__actual == PasoVerificado.No and " --------\n" == line:
            self.__actual = PasoVerificado.Anterior
            return False
        if self.__actual == PasoVerificado.Anterior:
            if " " in line:
                self.__actual = PasoVerificado.Siguiente
                return True
            else:
                self.__actual = PasoVerificado.No
                return False
        if self.__actual == PasoVerificado.Siguiente:
            if ' --------\n' == line:
                self._Value = self.__ValueTemp
                self._Found = True
                self._Active = False
                return False
            else:
                self.__actual = PasoVerificado.No
                self.__ValueTemp = ""
                return False
        return False

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        self.__ValueTemp = line

    def __str__(self):
        return f"Job Title: {self._Value}" if self._Found else ""

class ChargeMultiplicity(AtributoGeneric):
    class CM(object):
        def __init__(self, C: float, M: float):  # C = Charge, M = Multiplicity
            self.Charge: float = C
            self.Multiplicity: float = M

    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Value: Optional[ChargeMultiplicity.CM] = None

    def revision_condition(self, line: str, actual: object = None) -> bool:
        return ("Charge" in line and "Multiplicity" in line)

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        nums = self.numbers_extract(line)
        c = nums[0] if len(nums) > 0 else 0
        m = nums[1] if len(nums) > 1 else 1
        self._Value = self.CM(c, m)
        self._Active = False
        self._Found = True

    @property
    def Multiplicity(self) -> Optional[float]:
        return None if self._Value is None else self._Value.Multiplicity

    @property
    def Charge(self) -> Optional[float]:
        return None if self._Value is None else self._Value.Charge

    def __str__(self):
        if not self._Found or self._Value is None:
            return ""
        return f"Charge: {self._Value.Charge} Multiplicity: {self._Value.Multiplicity}"

class ThermalCorrectionToGibbs(AtributoGeneric):
    def __init__(self, palabra_a_buscar: string = None, separator: string = None):
        super().__init__(palabra_a_buscar, separator)
    def revision_condition(self, line: string, actual: object =None) -> bool:
        if("Thermal correction to Gibbs Free Energy=" in line):
            return True #fix error
        return False
    def Definir(self, line: string, multiline: bool = False, brakword: bool = False) -> None:
        self._Value = self.num_extract(line=line)
        self._Active=False
        self._Found =True
    
    def __str__(self):
        if(self._Found):
            return "Thermal correction to Gibbs Free Energy: "+str(self._Value)
        else:
            return ""


class Orbitales(object):
    def __init__(self) -> None:
        self.A: List[float] = []
        self.AL: List[float] = []
        self.B: List[float] = []
        self.BL: List[float] = []


class ListaOrbitales(AtributoGeneric):
    def __init__(self, palabra_a_buscar: str = None, separator: str = None):
        super().__init__(palabra_a_buscar, separator)
        self._Value: List[Orbitales] = []
        self.Orbital_Lineactual: str = "X"
        self.OrbitalactualUltimo: Optional[Orbitales] = None

    def revision_condition(self, line: str, actual: object = None) -> bool:
        if "Population analysis using the SCF density" in line:
            self.OrbitalactualUltimo = Orbitales()
            self._Value = [self.OrbitalactualUltimo]
            self._Active = True
            self._Found = True
            return False

        if self._Found:
            if "Alpha  occ. eigenvalues --" in line:
                self.Orbital_Lineactual = "A"
            elif "Alpha virt. eigenvalues --" in line:
                self.Orbital_Lineactual = "AL"
            elif "Beta  occ. eigenvalues --" in line:
                self.Orbital_Lineactual = "B"
            elif "Beta virt. eigenvalues --" in line:
                self.Orbital_Lineactual = "BL"
            else:
                self.Orbital_Lineactual = "X"

        return self.Orbital_Lineactual != "X"

    def Definir(self, line: str, multiline: bool = False, brakword: bool = False) -> None:
        if self.OrbitalactualUltimo is None:
            return
        if self.Orbital_Lineactual == "A":
            orbitales = self.OrbitalactualUltimo.A
        elif self.Orbital_Lineactual == "AL":
            orbitales = self.OrbitalactualUltimo.AL
        elif self.Orbital_Lineactual == "B":
            orbitales = self.OrbitalactualUltimo.B
        elif self.Orbital_Lineactual == "BL":
            orbitales = self.OrbitalactualUltimo.BL
        else:
            return
        orbitales.extend(self.numbers_extract(line))

    def __str__(self) -> str:
        if not self._Found or self.OrbitalactualUltimo is None:
            return ""
        # (mismo formateo que tenías, solo más compacto y con f-strings)
        out = f"\n  Last set of orbitals out of a total of: {len(self._Value)}\n"
        def dump(title, arr):
            if not arr: return ""
            s = f"{title}\n"
            for i, a in enumerate(arr, 1):
                s += f"{a}\t" if len(str(a)) >= 8 else f"{a}\t\t"
                if i % 5 == 0: s += "\n"
            return s + "\n\n"

        out += dump("***************** Alpha  occ. eigenvalues ***************", self.OrbitalactualUltimo.A)
        out += dump("***************** Alpha virt. eigenvalues *****************", self.OrbitalactualUltimo.AL)
        out += dump("***************** Beta  occ. eigenvalues *****************", self.OrbitalactualUltimo.B)
        out += dump("***************** Beta virt. eigenvalues *****************", self.OrbitalactualUltimo.BL)
        return out
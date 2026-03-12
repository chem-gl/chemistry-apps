from pathlib import Path
Path(__file__).resolve()

try:
    from Atributes import *  #NOSONAR
except ImportError:
    from read_log_gaussian.Atributes import *  #NOSONAR

class Estructura(object):
    '''
    contain  an Structure execution gaussian
    Attributes
    ----------
    chkPointFil                     %chk=
    comand                       
    jobtitle                        -----#   %chk=p
    frecNeg                         Frequencies --
    free_engergy                    Sum of electronic and thermal Free Energies
    zpe                             Sum of electronic and thermal Free Energies=
    eH_ts                           Sum of electronic and thermal Enthalpies
    temp                            Temperature
    isAnOptFreq                     opt freq
    scf                             SCF Done:
    zeroPointCorrection             Zero-point correction=
    thermalCorrectionToEnergy       thermalCorrectionToEnergy
    thermalcorrectiontoEnthalpy     thermalcorrectiontoEnthalpy
    thermalCorrectionToGibbs        thermalCorrectionToGibbs
    iSThermo                        
    listaOrbitales                  
    normalTerm                      
    multFreqs                       "imaginary frequencies" in line  and "1" not in line:
    chargeMultiplicity              Multiplicity
    '''



    def add(self,atributo_nuevo :AtributoString =None,atributos_nuevos :"list[AtributoString]" =None ):
        self.AtributosNuevos :list[AtributoGeneric]
        if(atributos_nuevos is not None):
            for atributostr in atributos_nuevos:
                atrib = AtributoGeneric(atributostr.NombreAtributo,atributostr.Separador)
                self.Atributos.append(atrib)
                self.AtributosNuevos.appen(atrib)

        if(atributo_nuevo is not None):
            self.Atributos.append(  AtributoGeneric( atributo_nuevo.NombreAtributo, atributo_nuevo.Separador))

    def __str__(self)->string:
        salida=""
        for atributo_actual  in self.Atributos:
            salida += str(atributo_actual) +"\n" if len(str(atributo_actual)) > 0 else ""
        
        return salida

    def __init__(self)->None:
        self.Atributos : list[AtributoGeneric] = list()
        self.chkPointFil:ChkPointFile = ChkPointFile()#   #p
        self.Atributos.append(self.chkPointFil)
        self.comand:Comando = Comando()#   -----
        self.Atributos.append(self.comand)
        self.jobtitle:JobTitle = JobTitle()#   Frequencies --
        self.Atributos.append(self.jobtitle)
        self.frecNeg:FrecuenciaNegativa = FrecuenciaNegativa()#   
        self.Atributos.append(self.frecNeg)
        self.zpe:ZeroPointEnergies = ZeroPointEnergies()#   
        self.Atributos.append(self.zpe)
        self.eH_ts:ThermalEnthalpies = ThermalEnthalpies()#   Sum of electronic and thermal Enthalpies
        self.Atributos.append(self.eH_ts)
        self.temp = Temperature()#   Temperature
        self.Atributos.append(self.temp)
        self.isAnOptFreq:IsAnOptFreq = IsAnOptFreq()#   opt freq
        self.Atributos.append(self.isAnOptFreq)
        self.scf:SCF = SCF()#   SCF Done:
        self.Atributos.append(self.scf)
        self.Thermal_Free_Enthalpies:ThermalFreeEnthalpies = ThermalFreeEnthalpies()#   Sum of electronic and thermal Free Energies
        self.Atributos.append(self.Thermal_Free_Enthalpies)
        self.zeroPointCorrection:ZeroPointCorrection = ZeroPointCorrection()#   Zero-point correction=
        self.Atributos.append(self.zeroPointCorrection)
        self.thermalCorrectionToEnergy:ThermalCorrectionToEnergy = ThermalCorrectionToEnergy()#   thermalCorrectionToEnergy
        self.Atributos.append(self.thermalCorrectionToEnergy)
        self.thermalcorrectiontoEnthalpy:ThermalcorrectiontoEnthalpy = ThermalcorrectiontoEnthalpy()#   thermalcorrectiontoEnthalpy
        self.Atributos.append(self.thermalcorrectiontoEnthalpy)
        self.thermalCorrectionToGibbs:ThermalCorrectionToGibbs = ThermalCorrectionToGibbs()#   thermalCorrectionToGibbs
        self.Atributos.append(self.thermalCorrectionToGibbs)
        self.iSThermo:ISThermo = ISThermo()#   
        self.Atributos.append(self.iSThermo)
        self.listaOrbitales:ListaOrbitales = ListaOrbitales()#   
        self.Atributos.append(self.listaOrbitales)
        self.normalTerm:NormalTermination = NormalTermination()#   
        self.Atributos.append(self.normalTerm)
        self.multFreqs:MultipleFrecuenciaNegativa = MultipleFrecuenciaNegativa()#   "imaginary frequencies" in line  and "1" not in li
        self.Atributos.append(self.multFreqs)
        self.chargeMultiplicity:ChargeMultiplicity = ChargeMultiplicity()#   Multiplicity
        self.Atributos.append(self.chargeMultiplicity)
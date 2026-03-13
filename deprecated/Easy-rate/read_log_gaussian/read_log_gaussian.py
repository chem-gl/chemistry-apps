from pathlib import Path
Path(__file__).resolve()

try:
    from Estructura import *   #NOSONAR
except ImportError:
    from read_log_gaussian.Estructura import *  #NOSONAR

class read_log_gaussian(object):
    def __init__(self, filename:string="", atributo_extra : AtributoString =None, atrributos_extra:"list[AtributoString]"= None )->None:
        self.Estructuras :list[Estructura] =list()
        self.__filename :string= filename
        self.__atributo_extra = atributo_extra
        self.__atrributos_extra = atrributos_extra
        self.analizar()
    
    def analizar(self)->None:
        self.__linea =0
        file = open(self.__filename)
        exe = None
        for line in file:
            self.__linea  += 1
            if "Initial command:" in line :
                exe:Estructura = Estructura()
                exe.add(self.__atributo_extra,self.__atrributos_extra)
                self.Estructuras.append(exe)
            if(exe is not None):
                for i, atributo in enumerate(exe.Atributos) :
                     
                    if(atributo.active and atributo.revision_condition(line=line,actual= exe)):
                        atributo.Definir(line)
                        atributo.set_line_num(self.__linea)
        file.close()    
    
    def __str__(self)->string:
        salida = ""
        for i, exe in enumerate(self.Estructuras):
            salida += str(i)+ " "+ exe.__str__() +"\n--------------------\n"
        return salida
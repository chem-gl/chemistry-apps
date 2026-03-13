from tst import tst

calculadoratst= tst()
'''
    DELZPE=float(input("ZPE Energy: "))
    BARRZPE=float(input("ZPE Barrier: "))
    FREQ=float(input("Imaginary frecuency (cm^-1) without negative sign: "))
    TEMP=float(input("Temperature: "))
'''

DELZPE=-8.2
BARRZPE=3.5 
FREQ= 625
TEMP=298.15

calculadoratst.calculate(DELZPE,BARRZPE,FREQ,TEMP)
print(calculadoratst)
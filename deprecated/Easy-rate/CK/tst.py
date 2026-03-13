import numpy as np
import matplotlib.pyplot as plt
import math 

class tst:
    def __init__(self,DELZPE:float=math.nan,BARRZPE:float=math.nan,FREQ:float=math.nan,TEMP:float=math.nan):#NOSONAR
        self.AV = 6.0221367e+23
        self.HPLANCK = 6.6260755e-34
        self.CLUZ = 2.9979246e+10
        self.BOLZ = 1.380658e-23
        self.CAL = 4184.0

        self.Y =[-.9982377,-.9907262,-.9772599,-.9579168,-.9328128,
                        -.9020988,-.8659595,-.8246122,-.7783057,-.7273183,
                        -.6719567,-.6125539,-.5494671,-.4830758,-.4137792,
                        -.3419941,-.2681522,-.1926976,-.1160841,-.0387724,
                            .0387724, .1160841, .1926976, .2681522, .3419941,
                            .4137792, .4830758, .5494671, .6125539, .6719567,
                            .7273183, .7783057, .8246122, .8659595, .9020988,
                            .9328128, .9579168, .9772599, .9907262, .9982377
        ]
        self.w=[            .0045213, .0104983, .0164211, .0222458, .0279370,
                            .0334602, .0387822, .0438709, .0486958, .0532278,
                            .0574398, .0613062, .0648040, .0679120, .0706116,
                            .0728866, .0747232, .0761104, .0770398, .0775059,
                            .0775059, .0770398, .0761104, .0747232, .0728866,
                            .0706116, .0679120, .0648040, .0613062, .0574398,
                            .0532278, .0486958, .0438709, .0387822, .0334602,
                            .027937 , .0222458, .0164211, .0104983, .0045213]
        
        self.ALPH1:float=math.nan
        self.ALPH2:float=math.nan
        self.U:float=math.nan
        #Voy a cambiar self.G por self.kappa, porque me confunde la G       self.G:float=math.nan
        self.Kappa=math.nan
        if(DELZPE is not math.nan or BARRZPE is not math.nan or FREQ is not  math.nan or TEMP is not math.nan): 
            self.calculate(DELZPE,BARRZPE,FREQ,TEMP)
        '''     
                *  -8.2,3.5 , 625, 298
        ''' 
     
    def calculate(self,DELZPE,BARRZPE,FREQ,TEMP):#NOSONAR
        if(FREQ <0):
            raise Exception("The frequency must not have a sign.")#NOSONAR
        self.ALPH1 = (2.0 * math.pi * BARRZPE * self.CAL) / (self.AV * self.HPLANCK * self.CLUZ * FREQ)
        self.ALPH2 = (2.0 * math.pi * (BARRZPE - DELZPE) * self.CAL) / (self.AV * self.HPLANCK * self.CLUZ * FREQ)
        self.U = (self.HPLANCK * self.CLUZ * FREQ)/(self.BOLZ * TEMP)

        PI2 = 2.0*math.pi
        UPI2 = self.U / PI2
        try:
            C = 0.125 * math.pi * self.U * math.pow(((1.0 / math.sqrt(self.ALPH1)) + (1.0 / math.sqrt(self.ALPH2))), 2)
            V1 = UPI2 * self.ALPH1
            V2 = UPI2 * self.ALPH2
            D = 4.0 * self.ALPH1 * self.ALPH2 - math.pow(math.pi, 2)
            DF = math.cosh(math.sqrt(D)) if D > 0.0 else math.cos(math.sqrt(-D))
            EZ= -V1 if V2 >= V1 else -V2
            EM = 0.5 * (self.U - EZ)
            EP = 0.5 * (self.U + EZ)
            self.Kappa = 0.0
            j=0
            while ( j < 40) :
                E = EM * self.Y[j] + EP
                A1 = math.pi * math.sqrt((E + V1) / C)
                A2 = math.pi * math.sqrt((E + V2) / C)
                FP = math.cosh(A1 + A2)
                FM = math.cosh(A1 - A2)
                self.Kappa = self.Kappa + self.w[j] * math.exp(-E) * (FP - FM) / (FP + DF)
                j=j+1
            self.Kappa = EM * self.Kappa + math.exp(-self.U)
        except ValueError:
            self.Kappa= math.nan
            raise Exception("Energy barrier or imaginary frequency exceeded. Check it!")#NOSONAR
            

    def __str__(self):
        return ("\n_________________________________________________\n \n U: \t\t" + str(round(self.U,3)) +  " \n Alpha 1:\t" + str(round(self.ALPH1,3)) +
            " \n Alpha 2:\t" + str(round(self.ALPH2,3)) + " \n G:\t\t" + str(round(self.Kappa,2))  +  " \n_________________________________________________\n")
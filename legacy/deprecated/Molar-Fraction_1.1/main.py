from tkinter import filedialog
import tkinter as tk
import tkinter.ttk as ttk
from tkinter.scrolledtext import ScrolledText
import numpy as np
from tkinter import *
import matplotlib.pyplot as plt
class Dato_pH:
    def __init__(self,ph) :
        self.ph = ph
        self.data=[]
        self.i=0
    def setData(self, dato):
        self.data.append(dato)
        self.i=self.i+1
    def __str__(self):
        a = round(self.ph,2).__str__() +"\t"
        for g in self.data:
            a+= format(g,'1.3E').__str__()+"\t\t"
        return a
class Molar_fraction:
    def __init__(self,pks, ini, fin, step):
        self.pks =[]
        self.pks = pks
        self.ini= ini
        self.fin=fin
        self.step=step
        self.Datos=[]
    def fBeta(self,k):
        suma=0.0
        if(k>self.pks.__len__()):
            raise Exception  ("k mayor que pk_a")
        for i in range(k):
            suma += self.pks[(self.pks.__len__())-i-1]
        return 10**suma

    def F0(self, V_pH):
        suma=1.0
        Con_H = 10 ** (-V_pH)
        for i in range(self.pks.__len__()):
            suma += self.fBeta(i+1)*Con_H**(i+1)
        return 1/suma

    def FK(self, V_pH, K):
        if(K==0):
            return self.F0(V_pH)
        Con_H = 10 ** (-V_pH)
        return self.F0(V_pH)*self.fBeta(K)*Con_H**K


    def getvalues(self):
        if(self.ini>self.fin):
            temp=self.ini
            self.ini=self.fin
            self.fin = temp
        numDatos =0
        for i in np.arange (self.ini, self.fin+self.step, self.step):
            self.Datos.append(Dato_pH(i))
            for j in range(0,self.pks.__len__()+1):
                self.Datos[numDatos].setData(self.FK(i,j))
            #print(self.Datos[numDatos].__str__())
            numDatos=numDatos+1
        return self.Datos
                
class GraficaApp:
    def pintarEntradas(self):
        i =0
        self.label = []
        self.Entrada=[]
        distance= 100
        distancey =-10
        self.framepksvalues = tk.Frame(self.frame7)
        self.labelpKa = tk.Label(self.framepksvalues)
        self.labelpKa.configure(compound='top', justify='left', text='Enter the pKa values here')
        self.labelpKa.place(anchor='nw', x='0', y='0')
        self.PHvalue.configure(state="disabled")
        for i in range(6):
            if(i%2==0):distancey, distance = distancey+40 ,0
            else : distance =125
            self.label.append(tk.Label(self.framepksvalues))
            self.label[i].configure(compound='right', takefocus=False, text='pKa'+str(i+1)+'=')
            self.label[i].place(anchor='nw', x=str(distance), y=str(distancey))
            self.Entrada.append( tk.Entry(self.framepksvalues,state='disabled'))
            self.Entrada[i].place(anchor='nw', width='55', x=str(distance+50), y=str(distancey))
            
        self.botonOk = tk.Button(self.framepksvalues,command=self.okButton)
        self.botonOk.configure(text='ok')
        self.botonOk.place(anchor='nw', width='50', x='90', y='150')
        self.framepksvalues.configure(relief='groove', width='250',borderwidth='1', height='200', highlightbackground='#000000', highlightcolor='#000000')
        self.framepksvalues.place(anchor='nw', bordermode='outside', x='35', y='100')
        #self.Entrada[0].configure(state="normal")   
        self.PHvalue.configure(state="disabled")
        self.CuantosPH.configure(state="disabled")      
    
    
    def okButton(self):
         self.CuantosPH.configure(state="normal")   

    def seleccionar(self,seleccion):
        i=0
        if  ( seleccion  ==   '1 pKa' ):      i=1
        elif( seleccion  ==  '2 pKas' ):   i=2
        elif( seleccion  ==  '3 pKas' ):   i=3  
        elif( seleccion  ==  '4 pKas' ):   i=4
        elif( seleccion  ==  '5 pKas' ):   i=5
        elif( seleccion  ==  '6 pKas' ):   i=6
        for a in range(6):
            self.Entrada[a].configure(state="disabled")
        for a in range(i):
            self.Entrada[a].configure(state="normal")  
    def onOpen(self):
        pass
        #print(filedialog.askopenfilename(initialdir = "/",title = "Open file",filetypes = (("Python files","*.py;*.pyw"),("All files","*.*"))))
    
    def onSave(self):
        files = [('All Files', '*.*'), 
             ('Python Files', '*.py'),
             ('Text Document', '*.txt')]
        file = tk.filedialog.asksaveasfile(filetypes = files, defaultextension = files)
        if file is None: # asksaveasfile return `None` if dialog closed with "cancel".
            return
        text2save = str(self.tkinterscrolledtext3.get("1.0", END)) # starts from `1.0`, not `0.0`
        file.write(text2save)
        file.close() # `()` was missing.
        
        
        
     
    def About(self):
        tk.messagebox.showinfo(title="© 2021 Copyright", message=" Annia Galano's Group")
    def __init__(self, master=None):
        self.Principal = tk.Tk() if master is None else tk.Toplevel(master)

        self.frame7 = tk.Frame(self.Principal, container='false')
        self.mainwindow = self.Principal
        
        self.Principal.title("Molar Fractions, 1.1")
        self.Principal.resizable(False, False) 

        menubar = tk.Menu(self.Principal)
        filemenu = tk.Menu(menubar, tearoff=0)
        filemenu.add_command(label="Save",command=self.onSave)
        filemenu.add_command(label="Exit",command=self.Principal.quit)
       
        menubar.add_cascade(label="File", menu=filemenu)
        help = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="help", menu=help)
        help.add_command(label="About",command=self.About)

        self.Principal.config(menu=menubar)

        self.label31 = tk.Label(self.frame7)
        self.label31.configure(compound='top', font='{Arial} 10 {bold}', justify='left', text='Data Entry')
        self.label31.place(anchor='nw', relwidth='0.12', relx='0.13', rely='0.06', x='0', y='0')
        self.label32 = tk.Label(self.frame7)
        self.label32.configure(compound='top', font='{Arial} 10', justify='left', text='Data Entry')
        self.label32.configure(relief='flat', text='Number of Acido Base Equilibria')
        self.label32.place(height='20', x='20', y='60')
        self.label5 = tk.Label(self.frame7)
        self.label5.configure(text='pH values')
        self.label5.place(anchor='nw', x='60', y='310')
        self.ValormenuCuantosPH = tk.StringVar(value='')
        __values = ['One pH value', 'pH Range']
        self.CuantosPH = tk.OptionMenu(self.frame7, self.ValormenuCuantosPH, None, *__values, command=self.selectphnum)
        self.CuantosPH.place(anchor='nw', bordermode='inside', x='147', y='305',)
        self.CuantosPH.configure(state="disabled")
     
        self.label40 = tk.Label(self.frame7)
        self.label40.configure(compound='top', justify='left', text='Single pH Value')
        self.label40.place(anchor='nw', x='50', y='350')
        
        self.PHvalue = tk.Entry(self.frame7)
        self.PHvalue.place(anchor='nw', width='60', x='180', y='350')
        self.PHvalue.configure(state="disabled")
        
        self.frame9 = tk.Frame(self.frame7)
        
        

        self.label41 = tk.Label(self.frame9)
        self.label41.configure(compound='top', justify='left', text='Enter the pKa values here')
        self.label41.place(anchor='nw', x='0', y='0')
        
        self.pHini = tk.Entry(self.frame9)
        self.pHini.place(anchor='nw', width='60', x='15', y='50')
        
        self.pHend = tk.Entry(self.frame9)
        self.pHend.place(anchor='nw', width='60', x='95', y='50')
        
        self.phsteep = tk.Entry(self.frame9)
        self.phsteep.place(anchor='nw', width='60', x='175', y='50')
       
       
        self.label42 = tk.Label(self.frame9)
        self.label42.configure(takefocus=False, text='Min')
        self.label42.place(anchor='nw', x='30', y='28')

        self.label43 = tk.Label(self.frame9)
        self.label43.configure(takefocus=False, text='Max')
        self.label43.place(anchor='nw', x='110', y='28')

        self.label44 = tk.Label(self.frame9)
        self.label44.configure(takefocus=False, text='Step')
        self.label44.place(anchor='nw', x='190', y='28')

        self.frame9.configure(borderwidth='1', height='80', highlightbackground='#000000', highlightcolor='#000000')
        self.frame9.configure(relief='groove', width='250')
        self.frame9.place(anchor='nw', bordermode='outside', x='15', y='385')
        self.labelresult = tk.Label(self.frame7)
        self.labelresult.configure(compound='top', font='{Arial} 10 {bold}', justify='left', text='Results')
        self.labelresult.place(anchor='nw', x='550', y='30')
        self.frame10 = tk.Frame(self.frame7)

        self.tkinterscrolledtext3 = ScrolledText(self.frame10, wrap = "none", width = 40, height = 24)
        xsb = tk.Scrollbar(self.frame10,orient="horizontal", command=self.tkinterscrolledtext3.xview)        
        
        self.tkinterscrolledtext3.grid(row=1,column =0,columnspan=1)        
        self.tkinterscrolledtext3.focus()
        self.tkinterscrolledtext3.configure(xscrollcommand=xsb.set)
        xsb.grid(row=2, column=0, columnspan=1,sticky=E+N+S+W)
        self.frame10.pack()

        
        
        self.frame10.configure(borderwidth='1', height='370', relief='ridge') 
        self.frame10.place(anchor='nw', x='370', y='50')
        __valuesa = ['1 pKa', '2 pKas','3 pKas', '4 pKas','5 pKas', '6 pKas']
        self.numpksA = tk.StringVar(None)
        self.numpKs = tk.OptionMenu(self.frame7, self.numpksA, None, *__valuesa, command=self.seleccionar)
        self.numpKs.place(anchor='nw', bordermode='inside', x='240', y='58')
        self.disabledphentrys()
        self.frame7.configure(height='500', takefocus=True, width='730')
        self.frame7.grid()

        self.buttonEnviar = tk.Button(self.frame7,command=self.okEnviar)
        self.buttonEnviar.configure(text='ok')
        self.buttonEnviar.place(anchor='nw', width='50', x='275', y='355')
        self.buttonEnviar.configure(state='disable')
        
        self.Graficar = tk.Button(self.frame7)
        self.Graficar.configure(text='Grafica',command=self.okGraficar)
        self.Graficar.place(anchor='nw', width='60', x='280', y='395')
        self.Graficar.configure(state='disable')
        self.pintarEntradas()

    def okGraficar(self):
        MF = Molar_fraction(self.getALLPKs(),.1,14,.1)
        result = MF.getvalues()
        
        ax = plt
        texto =""
        i=0
        for pk in self.getALLPKs():
            texto += "pk"+str(1+i)+": "+str(pk)+"\t "
            i=i+1
            
        ax.figure(num=texto)
       
        pHs = np.arange(0,14,0.1)

        for i in range(self.getALLPKs().__len__()+1):
            le =""
            if(i>0):
                le="H"+str(i+1)
            ax.plot(pHs,MF.FK(pHs,i),'-', label=le+"A")
        ax.xlabel('pH')
        legend = ax.legend(loc='best', shadow=False, fontsize='large')
        # Put a nicer background color on the legend.
        legend.get_frame().set_alpha(None)
        legend.get_frame().set_facecolor((0, 0, 1, 0.1))

        ax.title('Molar Fractions Graphic')
        

    
        ax.show()


    def getNumpks(self):
        i=0
        if(  self.numpksA.get() == '1 pKa'  ):  i=1
        elif(self.numpksA.get() == '2 pKas' ):  i=2
        elif(self.numpksA.get() == '3 pKas' ):  i=3  
        elif(self.numpksA.get() == '4 pKas' ):  i=4
        elif(self.numpksA.get() == '5 pKas' ):  i=5
        elif(self.numpksA.get() == '6 pKas' ):  i=6
        return i

    def getALLPKs(self):
        AllPKs= []
        for a in range(self.getNumpks()):
            try:
                AllPKs.append( float(self.Entrada[a].get()))
            except ValueError:
                raise Exception  ("Not a float")
        return AllPKs

    def okEnviar(self):
        self.Graficar.configure(state='disable')
        valor =0
        i=self.getNumpks()
        AllPKs= self.getALLPKs()
        valor   =0
        pHini   =0
        pHend   =0
        pHsteep =0
        if(self.ValormenuCuantosPH.get() == "One pH value"):
            try:
                valor= float(self.PHvalue.get())
            except ValueError:
                raise Exception  ("Not a float")
            pHini   =   valor
            pHend   =   valor
            pHsteep =   0.1
        elif(self.ValormenuCuantosPH.get() == "pH Range"):
             pHini  =float(self.pHini.get())
             pHend  =float(self.pHend.get())
             pHsteep=float(self.phsteep.get())
        else:
            return
        apo = Molar_fraction(AllPKs,pHini,pHend,pHsteep)
        resul =apo.getvalues()
        text ="pH\t"
        for i in range(resul[0].i):
            text +="f"+i.__str__()+"\t\t"
        text +="\n"
        for res in resul:
            text+=res.__str__()+"\n"  
        self.tkinterscrolledtext3.insert(END,text)
        self.Graficar.configure(state='normal')

    def run(self):
    
        self.mainwindow.mainloop()
    def disabledphentrys(self):
        for child in self.frame9.winfo_children():
            child.configure(state='disable')
    def selectphnum(self,select):
        self.disabledphentrys()
        self.PHvalue.configure(state="disabled")
        self.buttonEnviar.configure(state='disable')
        self.Graficar.configure(state='disable')
        if(select == "pH Range"):
            for child in self.frame9.winfo_children():
                child.configure(state='normal')
        elif(select == "One pH value"):
            self.PHvalue.configure(state="normal")
        else:
            return
        self.buttonEnviar.configure(state='normal')
        

if __name__ == '__main__':
    app = GraficaApp()
    app.run()

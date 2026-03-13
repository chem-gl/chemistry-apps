import math
import os
from tkinter import filedialog, font, messagebox, ttk
import tkinter as tk
from tkinter.scrolledtext import ScrolledText
import numpy as np
from threading import Thread as thTread
from tkinter import *
from tkinter.filedialog import askopenfilename
from SeslectStructura import SelectStructure
from viewStructure import ViewStructure
from tkdialog import WaitAlert
from read_log_gaussian.read_log_gaussian import *
import threading
import tkinter as tk
from tkinter import ttk
from ttkthemes import ThemedStyle
from time import sleep as tsleep
from os import path

class EntradaDato(ttk.Frame):
    ruta = "."
    '''
    Analiza los datos que obtenidos del log gaussian
    pyinstaller ../main.py -F --onedir --onefile
    '''
    def Activar(self, etiqueta="Sin nombre", buttontext="Browse", dato=0.0, dato2=NONE, info="", command=None):
        self.__dato = dato
        self.dato2 =dato2
        self.etiqueta = etiqueta
        self.textoButton = buttontext
        self.Archlog = None
        self.labelEtiquetaNombre = ttk.Label(self, text=self.etiqueta, width=17)
        
        
        self.datoentrada = Entry(self, width=10)
        self.datoentrada.insert(0, str(self.__dato))
        self.datoentrada["state"] = "disabled"
        self.botonActivo = ttk.Button(
            self, text=self.textoButton, width=7, command=self.open)
        self.grid(pady=5)
        
        
        self.labelEtiquetaNombre.grid(row=0, column=1)
        self.datoentrada.grid(row=0, column=2)
        self.botonActivo.grid(row=0, column=3)
        self.filname = ""
        self.esperar: int = 0
        self.botonverfile = ttk.Button(
            self, text="view", width=5, command=self.view)
        self.botonverfile.grid(row=0, column=4, padx=4)
        self.botonverfile['state'] = "disabled"

        self.botonclearfile = ttk.Button(
            self, text="clear", width=5, command=self.clear)
        self.botonclearfile.grid(row=0, column=5, padx=4)
        self.botonclearfile['state'] = "disabled"

        self.labelEtiquetafilename = ttk.Label(self, text="")
        self.labelEtiquetafilename.grid(row=1, column=2, columnspan=4, padx=4)
        self.comando = command
        self.EstructuraSeleccionada = None

    def clear(self):
        self.Archlog = None
        self.EstructuraSeleccionada = None
        self.botonverfile['state'] = "disabled"
        self.botonclearfile['state'] = "disabled"
        self.labelEtiquetafilename.config(text="")
        self.datoentrada.config(state='normal')
        self.datoentrada.delete(0, END)  # clear the entry
        self.datoentrada.insert(0, str("0.0"))
        self.datoentrada.config(state='disabled')

    def view(self):
        ViewStructure(master=self, estructure=self.EstructuraSeleccionada)

    def open(self):
        filetypes = [
            ("log Gaussian file",  "*.log"),
            ("txt format Gaussian", "*.txt"),
            ("out Gaussian file",  "*.out")
        ]
        self.mensajeEsperar: WaitAlert
        self.filename = askopenfilename(initialdir=EntradaDato.ruta,
                                        filetypes=filetypes,
                                        title="Choose a file.")
        if(self.filename == ""):
            return
        else:
            EntradaDato.ruta = os.path.dirname(os.path.abspath(self.filename))
        read = thTread(target=self.readfile)
        read.start()
        while(self.Archlog == None):
            self.esperar = 1
            self.mensajeEsperar = WaitAlert(parent=self,
                                            title='Reading the file',
                                            message='Please wait',
                                            pause=self.esperar)  # show countdown.

        if(self.Archlog == False):
            self.Archlog = None
            self.botonverfile['state'] = "disabled"
            self.botonclearfile['state'] = "disabled"
        self.SeleccionarEstructura()
        self.Archlog = None

    def readfile(self):
        self.Archlog = None
        self.EstructuraSeleccionada = None
        self.Archlog = read_log_gaussian(self.filename)
        tsleep(0.5)
        self.botonverfile['state'] = "normal"
        self.botonclearfile['state'] = "normal"
        if(self.Archlog.Estructuras.__len__ == 0):
            self.Archlog = False4
    def getDato(self) -> float:
        return self.__dato

    @property
    def getTextValue(self) -> float:
        return float(self.datoentrada.get())

    def get_Estructura_Seleccionada(self):
        return self.EstructuraSeleccionada

    def setDato(self, un_dato: float = 0.0):
        self.__dato = un_dato
        self.datoentrada.config(state='normal')
        self.datoentrada.delete(0, END)
        self.datoentrada.insert(0, str(un_dato))
        self.datoentrada.config(state='disabled')

    def SeleccionarEstructura(self):
        self.EstructuraSeleccionada = None
        if(len(self.Archlog.Estructuras) == 1):
            self.EstructuraSeleccionada = self.Archlog.Estructuras[0]
        else:
            self.a = SelectStructure(
                parent=self, estructuras=self.Archlog.Estructuras)
            if(self.a == None):
                self.EstructuraSeleccionada = None
            else:
                self.EstructuraSeleccionada = self.a.result
        if(self.EstructuraSeleccionada != None):
            self.comando(self.EstructuraSeleccionada)
            self.labelEtiquetafilename.config(
                text=(path.basename(self.filename))[:35])
        else:
            self.labelEtiquetafilename.config(text="")
            self.filename = ""




class MarcusApp:
    def __init__(self, master=None):
        self.master = tk.Tk() if master is None else tk.Toplevel(master)
        self.Principal = ttk.Frame(self.master)
        ttk.setup_master(self.master)
        style = ThemedStyle(self.master )
        self.Principal.pack_propagate(True)
        self.Principal.place(anchor='nw', bordermode='outside', x=str(0), y=str(0))
       
        self.master.title("Marcuskin 1.1")
        self.master.resizable(False, False)
        self.master.geometry("890x600")

        self.FramePrincipal = ttk.Frame(self.Principal)
        self.Principal.configure(width='960',height='605')
        self.menu() 
        self.SeecionTemperatura()
        self.SeccionDifusion()
        self.SeccionPantalla() 
        self.SeccionLeerArchivos()
        self.visc = 8.91e-4 
        self.kBoltz = 1.38066E-23
        
        style.set_theme('winxpblue')
        style.configure('.', background= '#f0f0f0', font=('calibri', 9))
    
    def menu(self):
        menubar = tk.Menu(self.master)
        filemenu = tk.Menu(menubar, tearoff=0)
        filemenu.add_command(label="Save",command=self.onSave)
        filemenu.add_command(label="Exit",command=self.Principal.quit)
        menubar.add_cascade(label="File", menu=filemenu)
        help = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="help", menu=help)
        help.add_command(label="About",command=self.About)
        
        self.master.config(menu=menubar)
    

    def SeccionLeerArchivos(self,pos_x=10,pos_y=10):
        seccionLeerArchivos = ttk.Frame(self.Principal)
        seccionLeerArchivos.configure(width='360',height='355')

        labelData_entry = ttk.Label(self.Principal,text="Data entry", font=('calibri', 9,"bold"))
        labelData_entry.place(x=str(pos_x), y=str(pos_y))
        
        seccionLeerArchivos.place(anchor='nw', bordermode='outside', x=str(pos_x), y=str(pos_y+10))

        tabla =ttk.Frame(seccionLeerArchivos)
        tabla.place(anchor='nw', bordermode='outside', x='10', y='10')

        labelEtiquetaNombre = ttk.Label(tabla,text="Run title")
        labelEtiquetaNombre.grid(row = 1, column = 1)

        self.Title = tk.Entry(tabla)
        self.Title.insert(0,str("Title"))
        self.Title.grid(row = 1, column = 2)
        
        self.React_1        = EntradaDato(tabla)
        self.React_1       .grid(row=2,column=1,columnspan = 3) 
        self.React_1       .Activar(etiqueta="React-1"
                            ,command=self.defReact_1       )
        
        self.React_2        = EntradaDato(tabla)
        self.React_2       .grid(row=3,column=1,columnspan = 3) 
        self.React_2       .Activar(etiqueta="React-2"
                            ,command=self.defReact_2       )
        
        self.Prduct_1_adiab = EntradaDato(tabla)
        self.Prduct_1_adiab.grid(row=4,column=1,columnspan = 3) 
        self.Prduct_1_adiab.Activar(etiqueta="Product-1(adiab.)"
                            ,command=self.defPrduct_1_adiab)
        
        self.Prduct_2_adiab = EntradaDato(tabla)
        self.Prduct_2_adiab.grid(row=5,column=1,columnspan = 3) 
        self.Prduct_2_adiab.Activar(etiqueta="Product-2(adiab.)"
                            ,command=self.defPrduct_2_adiab)
        
        self.Prduct_1_vert  = EntradaDato(tabla)
        self.Prduct_1_vert .grid(row=6,column=1,columnspan = 3) 
        self.Prduct_1_vert .Activar(etiqueta="Product-1(vert.)"
                            ,command=self.defPrduct_1_vert )
        
        self.Prduct_2_vert  = EntradaDato(tabla)
        self.Prduct_2_vert .grid(row=7,column=1,columnspan = 3) 
        self.Prduct_2_vert .Activar(etiqueta="Product-2(vert.)"
                            ,command=self.defPrduct_2_vert )


    def defReact_1       (self,Estruc:Estructura):
        self.Temperatura.delete(0,END)
        self.Temperatura.insert(0,str(Estruc.temp.getValue))
        self.Temperatura['state'] ="disabled"
        self.React_1.setDato(un_dato=Estruc.scf.getValue)
        
    def defReact_2       (self,Estruc:Estructura):
        self.React_2.setDato(un_dato=Estruc.scf.getValue)
    def defPrduct_1_adiab(self,Estruc:Estructura):
        self.Prduct_1_adiab.setDato(un_dato=Estruc.scf.getValue)
    def defPrduct_2_adiab(self,Estruc:Estructura):
        self.Prduct_2_adiab.setDato(un_dato=Estruc.scf.getValue)
    def defPrduct_1_vert (self,Estruc:Estructura):
        self.Prduct_1_vert.setDato(un_dato=Estruc.scf.getValue)
    def defPrduct_2_vert (self,Estruc:Estructura):
        self.Prduct_2_vert.setDato(un_dato=Estruc.scf.getValue)


    def SeecionTemperatura(self,pos_x=30,pos_y=400): 
        seccionTemperatura= ttk.Frame(self.Principal)
        seccionTemperatura.configure(width='200',height='50')
        seccionTemperatura.place(x=str(pos_x),y=str(pos_y+15))
        labelEtiquetaTemperatura = ttk.Label(seccionTemperatura,text="Temperature(K)" )
        labelEtiquetaTemperatura.grid(row = 1, column = 1)
        self.Temperatura = tk.Entry(seccionTemperatura)
        self.Temperatura.grid(row = 1, column = 2)
        self.Temperatura.insert(0,"298.15")

    def SeccionDifusion(self,pos_x=30,pos_y=440):
        seccionDifusion= ttk.Frame(self.Principal)
        seccionDifusion.configure(width='400',height='400')
        seccionDifusion.place(x=str(pos_x),y=str(pos_y))
        frame1=ttk.Frame(seccionDifusion)
        frame1.place(x="1",y="10")
        self.difusion=IntVar()
        self.difusion.set(0)
        ttk.Label(frame1,text="Do you want to consider difusion?").grid(column=0,row=0)
        ttk.Label(frame1,text="yes").grid(column=1,row=0)
        ttk.Radiobutton(frame1,value=1,variable=self.difusion, command=self.isDifusion).grid(column=2,row=0)
        ttk.Label(frame1,text="No").grid(column=4,row=0)
        ttk.Radiobutton(frame1,value=0,variable=self.difusion, command=self.isDifusion).grid(column=5,row=0)

        frame2=ttk.Frame(seccionDifusion)
        frame2.place(x="30",y="30")
        frame2.configure(width='900',height='200')
        labelradius = ttk.Label(frame2,text="Radius (in Angstroms) for:")
        labelradius.place(x="15",y="15")
        labelreact1 = ttk.Label(frame2,text="Reactant-1")
        labelreact1.place(x="30",y="35")
        self.radius_react_1 = tk.Entry(frame2,width=15,state='disabled')
        self.radius_react_1.place(x="95",y="35")
        labelreact1 = ttk.Label(frame2,text="Reactant-2")
        labelreact1.place(x="30",y="55")
        self.radius_react_2 = tk.Entry(frame2,width=15,state='disabled')
        self.radius_react_2.place(x="95",y="55")

        labelreact1 = ttk.Label(frame2,text="Reaction distance (in Angstroms)")
        labelreact1.place(x="30",y="75")
        self.ReactionDistance = tk.Entry(frame2,width=15,state='disabled')
        self.ReactionDistance.place(x="70",y="95")


    def isDifusion(self):
        if(self.difusion.get()==1):
            self.ReactionDistance['state'] = 'normal'
            self.radius_react_1  ['state'] = 'normal'
            self.radius_react_2  ['state'] = 'normal'
        else:
            self.radius_react_1['state'] = 'disabled'
            self.radius_react_2['state'] = 'disabled'
            self.ReactionDistance['state'] ='disabled'
    def copy_to_clipboard(self, event, *args):
        item = self.tree.identify_row(event.y) 
        self.clipboard_clear()
        self.clipboard_append(item)
    def SeccionPantalla(self,pos_x=400,pos_y=10):
        seccionPantalla= ttk.Frame(self.Principal)
        seccionPantalla.configure(width='600',height='700')
        seccionPantalla.place(x=str(pos_x),y=str(pos_y))
       
        boton = ttk.Button(seccionPantalla,text="Data ok, Run", command=self.run_calc)
        boton.place(x="200",y="10")
        frame10 = ttk.Frame(seccionPantalla)
        frame10.place( x='0', y='55')
        self.salida = ScrolledText(frame10, wrap = "none", width = 70, height = 35)
        xsb = tk.Scrollbar(frame10,orient="horizontal", command=self.salida.xview)        
        self.salida.bind('<Control-c>', self.copy_to_clipboard)
        self.salida.grid(row=1,column =0,columnspan=1)        
        self.salida.focus()
        self.salida.configure(xscrollcommand=xsb.set)
        xsb.grid(row=2, column=0, columnspan=1,sticky=E+N+S+W)
        self.salida.bind("<Key>", lambda e: "break")
        labelrate = ttk.Label(seccionPantalla)
        labelrate.configure(cursor='arrow', justify='left', relief='raised', text='Rate constant units:\n-For bimolecular(M-1 s-1)\n -For unimolecular reactions(s-1)')
        labelrate.place(anchor='nw', x='0', y='500')

        labelphpadvertence = ttk.Label(seccionPantalla)
        labelphpadvertence.configure(cursor='based_arrow_down', justify='center', relief='groove', takefocus=False)
        labelphpadvertence.configure(text='Please note that pH is not\nconsidered here.\n\nCheck for updates in \nthis topic')
        labelphpadvertence.place(anchor='nw', x='300', y='500')

    def run_calc(self):
        c = self.radius_react_1  .get()
        b = self.radius_react_2  .get()
        a = self.ReactionDistance.get()
     
        react1_G = self.React_1.getDato()
        react2_G = self.React_2.getDato()
             
        react1_G_plus_correct = self.React_1.EstructuraSeleccionada.Thermal_Free_Enthalpies.getValue
        react2_G_plus_correct = self.React_2.EstructuraSeleccionada.Thermal_Free_Enthalpies.getValue

        prod1_G  = self.Prduct_1_adiab.getDato()
        prod2_G  = self.Prduct_2_adiab.getDato()
        
        prod1_G_plus_correct  = self.Prduct_1_adiab.EstructuraSeleccionada.Thermal_Free_Enthalpies.getValue
        prod2_G_plus_correct  = self.Prduct_2_adiab.EstructuraSeleccionada.Thermal_Free_Enthalpies.getValue
        


        prod1_Ev = self.Prduct_1_vert .getDato()
        prod2_Ev = self.Prduct_2_vert .getDato()

        
        if self.difusion.get() == 1 and (a =='' or b  =='' or  c ==''  ):
            messagebox.showerror(title="It is not possible to calculate", message="Please enter the missing value(s)")
            return
        
        aEnergy =self.getEnergy(prod1_G , prod2_G , react1_G , react2_G)
        aEnergy_round = round(aEnergy, 2)
        
        aEnergy_plus_correct = self.getEnergy(prod1_G_plus_correct, prod2_G_plus_correct, react1_G_plus_correct, react2_G_plus_correct)
        
        vEnergy = self.getEnergy(prod1_Ev, prod2_Ev, react1_G, react2_G)
        vEnergy_round = round(vEnergy, 2) 
        
        lam = (vEnergy - aEnergy_plus_correct)
        if lam == 0:
            messagebox.showerror(title="It is not possible to calculate", message="Please check Reacts and products values")
            return 

        lambda_round  = round(lam, 2)
        barrier:float = (lam / 4) * ((1 + (aEnergy_plus_correct / lam) )**2)
        barrier_round = round(barrier, 2)
        temp          =  float(self.Temperatura.get())
        try:
            rateCte:float = 2.08366912663558e10 * temp * math.exp(-1.0*barrier * 1000 / (1.987 * temp))
        except:
            messagebox.showerror(   title  = "Math range error.",
                                    message= "Please check you data.")
            rateCte:float = nan                        
        
        if self.difusion.get() == 1:
            radMolA   :float  = float(self.radius_react_1.get())
            radMolB   :float  = float(self.radius_react_2.get())
            reactDist :float  = float(self.ReactionDistance.get())
            diffCoefA :float  = (self.kBoltz * temp) / (6 * 3.14159 * self.visc * radMolA)
            diffCoefB :float  = (self.kBoltz * temp) / (6 * 3.14159 * self.visc * radMolB)
            diffCoefAB:float  = diffCoefA + diffCoefB
            kDiff     :float  = 1000 * 4 * 3.14159 * diffCoefAB * reactDist * 6.02e23
            kCorrDiff :float  = (kDiff * rateCte) / (kDiff + rateCte)    
        title =self.Title.get()
        #self.salida.delete('1.0', END)
        self.salida.insert(END,("Pathway:  " + title + "\n") )
        self.salida.insert(END,("Adiabatic energy (G) of reaction (kcal/mol):  " + str(round(aEnergy_plus_correct,2)) + "\n") )
        self.salida.insert(END,("Vertical energy (E) of reaction (kcal/mol):  " + str(round(vEnergy_round,2)) + "\n") )
        self.salida.insert(END,("Reorganization energy (kcal/mol):  " + str(round(lambda_round,2)) + "\n") )
        self.salida.insert(END,("Reaction barrier (kcal/mol):  " + str(round( barrier_round,2 ))+ "\n") )
        if self.difusion.get() == 0:
            self.salida.insert(END,("Rate Constant:  " +'{:0.2e}'.format(rateCte) ))
        elif self.difusion.get() == 1:
            self.salida.insert(END,("Rate Constant:  " + '{0:.2e}'.format(kCorrDiff)))
        self.salida.insert(END, "\n\n-----------------------------------------------------\n\n\n")
    def About(self):
        pass
    def getEnergy(self,prod1 , prod2 , react1 , react2):
        return 627.5095 * (prod1 + prod2 - react1 - react2)
    def onSave(self):
        file_path:string=None
        if file_path is None:
            file_path = filedialog.asksaveasfilename(
                 filetypes=( ("Text files", "*.txt"),("All files", "*.*"))) 
        try:
            # Write the Prolog rule editor contents to the file location
            with open(file_path, "w+") as file: 
                file.write(
                    "Entry Values: \n\n"+
                    "\t\tReact-1: "  +str(self.React_1       .getTextValue) + "\n"+
                    "\t\tReact-2: "  +str(self.React_2       .getTextValue) + "\n"+
                    "\t\tProduct-1(adiab.): "+str(self.Prduct_1_adiab.getTextValue) + "\n"+
                    "\t\tProduct-2(adiab.): "+str(self.Prduct_2_adiab.getTextValue) + "\n"+
                    "\t\tProduct-1(vert.): " +str(self.Prduct_1_vert .getTextValue) + "\n"+
                    "\t\tProduct-2(vert.): " +str(self.Prduct_2_vert .getTextValue) + "\n________________________\n\nOutput:\n"
                )
                file.write(
                    self.salida.get("1.0", END)+"\n")
                file.close()

        except FileNotFoundError:
            messagebox.showerror(   title  = "It is not possible to save",
                                    message= "Please contact to administrator")
            return
    def run(self):
        self.Principal.mainloop()
if __name__ == '__main__':
    app = MarcusApp()
    app.run()
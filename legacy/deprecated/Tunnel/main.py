from tkinter import filedialog, messagebox
from CK.tst import *
from tkinter import  ttk
import tkinter as tk
from tkinter.scrolledtext import ScrolledText
import numpy as np
from tkinter import *
from tkinter.filedialog import askopenfilename
import tkinter as tk
from tkinter import ttk
from ttkthemes import ThemedStyle
class Tunnel: 
    def __init__(self, master=None):
        self.master = tk.Tk() if master is None else tk.Toplevel(master)
        self.Principal = ttk.Frame(self.master)
        ttk.setup_master(self.master)
        style = ThemedStyle(self.master ) 
        self.Principal.place(anchor='nw', bordermode='outside', x=str(0), y=str(0)) 
        self.master.title("Tunnel")
        self.master.resizable(False, False)
        self.master.geometry("500x300") 
        self.FramePrincipal = ttk.Frame(self.Principal)
        self.Principal.configure(width='960',height='605') 
        style.set_theme('winxpblue')
        style.configure('.', background= '#f0f0f0', font=('calibri', 9))
        self.menu()
        self.Datos()
        self.Salida()
    '''DELZPE ->REaction energy plus ZPE Energy'''
    def Datos(self,pos_x=10,pos_y=10): 
        SeccionDatos= ttk.Frame(self.Principal)
        SeccionDatos.configure(width='200',height='50')
        SeccionDatos.place(x=str(pos_x),y=str(pos_y+15))
        label_R_B_ZPE = ttk.Label(SeccionDatos,text="Reaction barrier ZPE (kcal/mol): " )
        label_R_B_ZPE.grid(row = 1, column = 1, padx=(5, 15))
        self.entry_R_B_ZPE = tk.Entry(SeccionDatos)
        self.entry_R_B_ZPE.grid(row = 2, column = 1, padx=(5, 15))
        self.entry_R_B_ZPE.insert(0,"0.0")
        labelIma = ttk.Label(SeccionDatos,text="Imaginary frequency (cm-1): " )
        labelIma.grid(row = 3, column = 1, padx=(5, 15))
        self.entryIma = tk.Entry(SeccionDatos)
        self.entryIma.grid(row = 4, column = 1, padx=(5, 15))
        self.entryIma.insert(0,"0.0")
        label_Re_En_ZPE = ttk.Label(SeccionDatos,text="Reaction Energy ZPE (kcal/mol): " )
        label_Re_En_ZPE.grid(row = 5, column = 1, padx=(5, 15))
        self.entry_Re_En_ZPE = tk.Entry(SeccionDatos)
        self.entry_Re_En_ZPE.grid(row = 6, column = 1, padx=(5, 15))
        self.entry_Re_En_ZPE.insert(0,"0.0")
        label_Temp = ttk.Label(SeccionDatos,text="Temperature (K):  " )
        label_Temp.grid(row = 7, column = 1, padx=(5, 15))
        self.entry_Temp = tk.Entry(SeccionDatos)
        self.entry_Temp.grid(row = 8, column = 1, padx=(5, 15))
        self.entry_Temp.insert(0,"0.0")
        boton = ttk.Button(self.Principal,text="Data ok, Run", command=self.run_calc)
        boton.place(x="80",y="220")
    def run_calc(self):
        Resultados = tst()
        Resultados.calculate(BARRZPE=float(self.entry_R_B_ZPE.get()),
                            DELZPE=float(self.entry_Re_En_ZPE.get()),
                            FREQ=float(self.entryIma.get()),
                            TEMP=float(self.entry_Temp.get()))
        self.salida.delete('1.0', END)
        self.salida.insert(END,"U:        : "+str(Resultados.U )+ "\n")
        self.salida.insert(END,"Alpha 1:  : "+str(Resultados.ALPH1 )+ "\n")
        self.salida.insert(END,"Alpha 2:  : "+str(Resultados.ALPH2 )+ "\n")
        self.salida.insert(END,"G:        : "+str(Resultados.G )+ "\n")

    def menu(self):
        menubar = tk.Menu(self.master)
        filemenu = tk.Menu(menubar, tearoff=0)
        filemenu.add_command(label="Save",command=self.onSave)
        filemenu.add_command(label="Exit",command=self.master.quit)
        menubar.add_cascade(label="File", menu=filemenu)
        help = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="help", menu=help)
        help.add_command(label="About",command=self.About)
        self.master.config(menu=menubar)
    def onSave(self):
        if file_path_save is None:
            file_path_save = filedialog.asksaveasfilename(
                filetypes=( ("Text files", "*.txt"),("All files", "*.*"))) 
        try:
            with open(file_path_save, "w+") as file: 
                file.write(
                    "Entry Values: \n\n"+
                    "Reaction barrier ZPE (kcal/mol): "+str(self.entry_R_B_ZPE.get())+"\n"+
                    "Imaginary frequency (cm-1): "+str(self.entryIma.get())+"\n"+
                    "Reaction Energy ZPE (kcal/mol): "+str(self.entry_Re_En_ZPE.get())+"\n"+
                    "Temperature (K):  "+str(self.entry_Temp.get())+"\n\nResult:\n"
                )
                file.write(
                
                    self.salida.get("1.0", END)+
                    "\n"
                )
                file.close()
        except FileNotFoundError:
            messagebox.showerror(   title  = "It is not possible to save",
                            message= "Please contact to administrator")


    def About(self):#TODO #2 poner texto del about
        VentanaAbout = tk.Tk() if self.master is None else tk.Toplevel(self.master)
        Frame_VentanaAbout = ttk.Frame(VentanaAbout)
        ttk.setup_master(VentanaAbout)
        style = ThemedStyle(VentanaAbout )
        Frame_VentanaAbout.place(anchor='nw', bordermode='outside', x=str(0), y=str(0)) 
        VentanaAbout.title('Fram')
        VentanaAbout.resizable(False, False)
        VentanaAbout.geometry("400x300") 
        Frame_VentanaAbout.configure(width='960',height='605') 
        style.set_theme('winxpblue')
        style.configure('.', background= '#f0f0f0', font=('calibri', 9))

        SeccionDatos= ttk.Frame(Frame_VentanaAbout)
        SeccionDatos.configure(width='200',height='50')
        SeccionDatos.place(x=str(0),y=str(0+15))
        textoScrollBar = ScrolledText(SeccionDatos, wrap = "none", width = 33, height = 15)
        xsb = tk.Scrollbar(SeccionDatos,orient="horizontal", command=textoScrollBar.xview)
        textoScrollBar.grid(row=1,column =0,columnspan=1)
        textoScrollBar.focus()
        textoScrollBar.configure(xscrollcommand=xsb.set)
        xsb.grid(row=2, column=0, columnspan=1,sticky=E+N+S+W)
        textoScrollBar.bind("<Key>", lambda e: "break")
        textoScrollBar['state'] = "disabled"
        textoScrollBar.insert(END,"")

    def Salida(self,pos_x=200,pos_y=10): 
        SeccionDatos= ttk.Frame(self.Principal)
        SeccionDatos.configure(width='200',height='50')
        SeccionDatos.place(x=str(pos_x),y=str(pos_y+15))
        self.salida = ScrolledText(SeccionDatos, wrap = "none", width = 33, height = 15)
        xsb = tk.Scrollbar(SeccionDatos,orient="horizontal", command=self.salida.xview)        
        self.salida.grid(row=1,column =0,columnspan=1)        
        self.salida.focus()
        self.salida.configure(xscrollcommand=xsb.set)
        xsb.grid(row=2, column=0, columnspan=1,sticky=E+N+S+W)
        self.salida.bind("<Key>", lambda e: "break")
    def run(self):
        self.master.mainloop() #Todo fix this
if __name__ == '__main__':
    app = Tunnel()
    app.run()
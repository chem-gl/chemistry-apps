from tkinter import *
import tkinter as tk
import tkinter
from tkinter import scrolledtext
from tkinter import ttk
from tkinter.scrolledtext import *
from tkinter.filedialog import *
from tkinter import *
import tkinter.simpledialog as sd
import platform
from viewStructure import ViewStructure
from  read_log_gaussian.read_log_gaussian import *


class SelectStructure(sd.Dialog):
    """An alert which will wait for a given time before user can interact.

    Args:
        parent: Takes the parent window instance.
        title (str): Main heading of the alert.
        message (str): Information to display.
        pause (int): Time till inactive. (in seconds)
        show_timer (boolean): Shows countdown."""

    def __init__(self, parent, Estructuras:"list[Estructura]" ):
        self.sistema = platform.system()
        self.Estructuras = Estructuras
        self.result = None
        super().__init__(parent, title="Select a Structure")
    
    def body(self, master):
        # For macOS, we can use the below command to achieve a window similar to an alert.
        # Comment the below line if you are on windows.
        if self.sistema == "Darwin":
            self.tk.call("::tk::unsupported::MacWindowStyle", "style", self._w, "moveableAlert")

        box = Frame(self)

        labelTop = tk.Label(box,
                    text = "Choose your structure")
        labelTop.grid(column=0, row=0)
        self.SelectStructure = ttk.Combobox(box,values=list(map(lambda a:" Job Title: "+  a.jobtitle.getValue ,self.Estructuras )))
        self.SelectStructure.grid(column=0, row=1)
        self.SelectStructure.current(None)
        self.SelectStructure.size = [1200,150]
        
        b1 = Button(box, text="view", width=10, command=self.view)
        b1.grid(column=1, row=1)

        box.pack()

    def view(self):
        ViewStructure(self,estructure =  self.Estructuras[self.SelectStructure.current()])
    def buttonbox(self):
        box = Frame(self)
        b1 = Button(box, text="OK", width=10, command=self.ok)
        b1.pack(side=LEFT, padx=5, pady=5)        
        self.bind("<Return>", self.ok)
        box.pack()

    def apply(self):
        self.result = self.Estructuras[self.SelectStructure.current()]
        return super().apply()

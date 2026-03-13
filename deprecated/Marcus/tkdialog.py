from tkinter import ACTIVE, LEFT, Button, Frame, Label
import tkinter.simpledialog as sd
from  platform import system as  plsystem

class WaitAlert(sd.Dialog):
    """An alert which will wait for a given time before user can interact.

    Args:
        parent: Takes the parent window instance.
        title (str): Main heading of the alert.
        message (str): Information to display.
        pause (int): Time till inactive. (in seconds)
        show_timer (boolean): Shows countdown."""

    def __init__(self, parent, title=None, message=None, pause=None, show_timer=False):
        self.message = message or ''
        self.pause = pause
        self.show_timer = show_timer
        self.sistema = plsystem()
        super().__init__(parent, title=title)

    def body(self, master):
        # For macOS, we can use the below command to achieve a window similar to an alert.
        # Comment the below line if you are on windows.
        if self.sistema == "Darwin":
            self.tk.call("::tk::unsupported::MacWindowStyle", "style", self._w, "moveableAlert")
        Label(master, text=self.message).pack()

    def _timer(self, count, b1):
        "Timer function."
        if count > 0:
            if self.show_timer: b1['text'] = str(count)
            self.after(2000, self._timer, count-1, b1)
        else:
            if self.show_timer: b1['text'] = "OK"
            b1['state'] = 'normal'
      

    def buttonbox(self):
        box = Frame(self)
        b1 = Button(box, text="OK", width=10, command=self.ok, default=ACTIVE, state='disabled')
        b1.pack(side=LEFT, padx=5, pady=5)
        if self.pause is not None: 
            self._timer(self.pause, b1)
        self.bind("<Return>", self.ok)
        self.bind("<Escape>", self.cancel)
        box.pack()
    def apply(self):
        self.result = True
        return super().apply()

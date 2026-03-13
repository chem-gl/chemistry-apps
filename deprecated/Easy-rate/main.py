import os
from math import exp, isnan, log, nan
from os import path
from threading import Thread as thTread
from time import sleep as tsleep
from tkinter import (
    END,
    Button,
    E,
    Entry,
    IntVar,
    Label,
    Menu,
    N,
    S,
    Scrollbar,
    Tk,
    Toplevel,
    W,
    filedialog,
    messagebox,
    ttk,
)
from tkinter.filedialog import askopenfilename
from tkinter.scrolledtext import ScrolledText

from CK.tst import tst
from read_log_gaussian.Estructura import Estructura
from read_log_gaussian.read_log_gaussian import read_log_gaussian
from SeslectStructura import SelectStructure
from tkdialog import WaitAlert
from ttkthemes import ThemedStyle
from viewStructure import ViewStructure

"""
    Python 3.9.*
    @author: Cesar Gerardo Guzman Lopez
    @Description:  Programa easy rate
"""

# constantes físicas / conversión (arriba del archivo)
HARTREE_TO_KCAL = 627.5095
R_GAS_KCAL = 1.987 / 1000  # kcal·mol−1·K−1
KB = 1.380649e-23  # J/K
NA = 6.02214076e23
PI = 3.141592653589793
ANGSTROM_TO_M = 1e-10

LAST_DIR = None  # recuerda la última carpeta usada


class EntradaDato(ttk.Frame):
    """
    Analiza los datos que obtenidos del log gaussian
    """

    def Activar(
        self,
        etiqueta="Sin nombre",
        buttontext="Browse",
        dato=0.0,
        info="",
        command=None,
    ):
        self.__dato = dato
        self.Etiqueta = etiqueta
        self.textoButton = buttontext
        self.Archlog = None
        self.labelEtiquetaNombre = ttk.Label(self, text=self.Etiqueta, width=17)
        self.datoentrada = Entry(self, width=10)
        self.datoentrada.insert(0, str(self.__dato))
        self.datoentrada["state"] = "disabled"
        self.botonActivo = ttk.Button(
            self, text=self.textoButton, width=7, command=self.open
        )
        self.grid(pady=5)
        self.labelEtiquetaNombre.grid(row=0, column=1)
        self.datoentrada.grid(row=0, column=2)
        self.botonActivo.grid(row=0, column=3)
        self.filname = ""
        self.esperar: int = 0
        self.botonverfile = ttk.Button(self, text="view", width=5, command=self.view)
        self.botonverfile.grid(row=0, column=4, padx=4)
        self.botonverfile["state"] = "disabled"

        self.botonclearfile = ttk.Button(
            self, text="clear", width=5, command=self.clear
        )
        self.botonclearfile.grid(row=0, column=5, padx=4)
        self.botonclearfile["state"] = "disabled"

        self.labelEtiquetafilename = ttk.Label(self, text="")
        self.labelEtiquetafilename.grid(row=1, column=3, columnspan=2, padx=4)
        self.comando = command
        self.EstructuraSeleccionada = None

    def clear(self):
        self.Archlog = None
        self.EstructuraSeleccionada = None
        self.botonverfile["state"] = "disabled"
        self.botonclearfile["state"] = "disabled"
        self.labelEtiquetafilename.config(text="")
        self.datoentrada.config(state="normal")
        self.datoentrada.delete(0, END)  # clear the entry
        self.datoentrada.insert(0, str("0.0"))
        self.datoentrada.config(state="disabled")

    def view(self):
        ViewStructure(master=self, estructure=self.EstructuraSeleccionada)

    def open(self):
        global LAST_DIR
        filetypes = [
            ("log Gaussian file", "*.log"),
            ("txt format Gaussian", "*.txt"),
            ("out Gaussian file", "*.out"),
        ]
        initial = LAST_DIR if (LAST_DIR and os.path.isdir(LAST_DIR)) else os.getcwd()
        self.filename = askopenfilename(
            initialdir=initial, filetypes=filetypes, title="Choose a file:"
        )

        if not self.filename:
            return

        LAST_DIR = os.path.dirname(self.filename)

        # Lanzar hilo
        self._worker = thTread(target=self._readfile_worker, daemon=True)
        self._worker.start()

        # Empezar polling no bloqueante
        self.after(100, self._check_reader_done)

    def _readfile_worker(self):
        self.Archlog = read_log_gaussian(self.filename)

    def _check_reader_done(self):
        if self.Archlog is None:
            self.after(100, self._check_reader_done)
            return

        ok = bool(self.Archlog)
        self.botonverfile["state"] = "normal" if ok else "disabled"
        self.botonclearfile["state"] = "normal" if ok else "disabled"
        if ok:
            self.SeleccionarEstructura()
            self.Archlog = None

    def readfile(self):
        self.Archlog = None
        self.EstructuraSeleccionada = None
        self.Archlog = read_log_gaussian(self.filename)
        tsleep(0.5)
        self.botonverfile["state"] = "normal"
        self.botonclearfile["state"] = "normal"
        if len(self.Archlog.Estructuras) == 0:
            self.Archlog = False

    @property
    def getDato(self) -> float:
        return self.__dato

    @property
    def getTextValue(self) -> float:
        return float(self.datoentrada.get())

    def get_Estructura_Seleccionada(self):
        return self.EstructuraSeleccionada

    def setDato(self, un_dato: float = 0.0):
        self.__dato = un_dato
        self.datoentrada.config(state="normal")
        self.datoentrada.delete(0, END)
        self.datoentrada.insert(0, str(un_dato))
        self.datoentrada.config(state="disabled")

    def SeleccionarEstructura(self):
        self.EstructuraSeleccionada = None
        if len(self.Archlog.Estructuras) == 1:
            self.EstructuraSeleccionada = self.Archlog.Estructuras[0]
        else:
            self.a = SelectStructure(parent=self, estructuras=self.Archlog.Estructuras)
            if self.a == None:
                self.EstructuraSeleccionada = None
            else:
                self.EstructuraSeleccionada = self.a.result
        if self.EstructuraSeleccionada != None:
            self.comando(self.EstructuraSeleccionada)
            self.labelEtiquetafilename.config(text=path.basename(self.filename))
        else:
            self.labelEtiquetafilename.config(text="")
            self.filename = ""


class exception_tunnel(Exception):
    """
    Exception for tunneling errors
    """

    def __init__(self, message):
        super(exception_tunnel, self).__init__(message)
        self.message = message


class Ejecucion:
    """
    Guarda la informacion de una ejecucion y se hacen los calculos
    """

    def __init__(
        self,
        title: str = "Title",
        react_1: Estructura = None,
        react_2: Estructura = None,
        transition_rate: Estructura = None,
        product_1: Estructura = None,
        product_2: Estructura = None,
        cage_efects: bool = False,
        diffusion: bool = False,
        solvent: str = "",
        radius_1: float = nan,
        radius_2: float = nan,
        reaction_distance: float = nan,
        degen: float = nan,
        print_data=False,
        visc_custom: float = nan,
    ):
        self.visc_custom: float = visc_custom

        if transition_rate is None:
            raise exception_tunnel(
                "Please check your files are in the correct format,\n "
                "if the error persists please contact the administrator"
            )
        if react_1 is None:
            react_1 = Estructura()
        if product_1 is None:
            product_1 = Estructura()
        if react_2 is None:
            react_2 = Estructura()
        if product_2 is None:
            product_2 = Estructura()
        self.pathway: str = title
        self.title = title
        self.React_1: Estructura = react_1
        self.React_2: Estructura = react_2
        self.transition_rate: Estructura = transition_rate
        self.Product_1: Estructura = product_1
        self.product_2: Estructura = product_2
        self.frequency_negative = self.transition_rate.frecNeg.getValue
        self.temp = self.Product_1.temp.getValue
        self.cage_efects: bool = cage_efects
        self.diffusion: bool = diffusion
        self.solvent: str = solvent
        self.radius_1: float = radius_1
        self.radius_2: float = radius_2
        self.reaction_distance: float = reaction_distance
        self.degeneracy: float = degen
        self.Zreact: float = nan
        self.Zact: float = nan
        self.dH_react: float = nan
        self.dHact: float = nan
        self.Greact: float = nan
        self.Gact: float = nan
        self.rateCte: float = nan
        self.CalcularTunel: tst = tst()
        self.ejecutable: bool = False
        self.PrintData: bool = print_data

    def run(self) -> None:
        self.ejecutable = True
        """
            Reaction enthalpies (dh)
        """
        self.dH_react: float = 627.5095 * (
            self.Product_1.eH_ts.no_nan_value
            + self.product_2.eH_ts.no_nan_value
            - self.React_1.eH_ts.no_nan_value
            - self.React_2.eH_ts.no_nan_value
        )
        self.dHact: float = 627.5095 * (
            self.transition_rate.eH_ts.getValue
            - self.React_1.eH_ts.no_nan_value
            - self.React_2.eH_ts.no_nan_value
        )
        """
            Reaction Zero_point_Energies (dh)
        """
        self.Zreact: float = 627.5095 * (
            self.product_2.zpe.no_nan_value
            + self.Product_1.zpe.no_nan_value
            - self.React_1.zpe.no_nan_value
            - self.React_2.zpe.no_nan_value
        )
        self.Zact: float = 627.5095 * (
            self.transition_rate.zpe.getValue
            - self.React_1.zpe.no_nan_value
            - self.React_2.zpe.no_nan_value
        )

        gibbsR1 = self.React_1.Thermal_Free_Energies.no_nan_value  # NOSONAR
        gibbsR2 = self.React_2.Thermal_Free_Energies.no_nan_value  # NOSONAR
        gibbsTS = self.transition_rate.Thermal_Free_Energies.getValue  # NOSONAR
        gibbsP1 = self.Product_1.Thermal_Free_Energies.no_nan_value  # NOSONAR
        gibbsP2 = self.product_2.Thermal_Free_Energies.no_nan_value  # NOSONAR

        molarV = 0.08206 * self.temp

        countR = 1 if gibbsR1 == 0.0 or gibbsR2 == 0.0 else 2
        countP = 1 if gibbsP1 == 0.0 or gibbsP2 == 0.0 else 2

        deltaNr = countP - countR
        deltaNt = 1 - countR
        corr1Mr = R_GAS_KCAL * self.temp * log(pow(molarV, deltaNr))
        corr1Mt = R_GAS_KCAL * self.temp * log(pow(molarV, deltaNt))

        # Calor de reacción
        self.Greact: float = corr1Mr + 627.5095 * (
            gibbsP2 + gibbsP1 - gibbsR1 - gibbsR2
        )
        # Energia de activación
        self.Gact: float = corr1Mt + 627.5095 * (gibbsTS - gibbsR1 - gibbsR2)

        """
            If Cage Correction is used:
        """
        if self.cage_efects and deltaNt != 0:
            cageCorrAct = (
                R_GAS_KCAL
                * self.temp
                * ((log(countR * pow(10, 2 * countR - 2))) - (countR - 1))
            )
            self.Gact: float = self.Gact - cageCorrAct
        """
            Tunnel section using classes in tst.py:
        """
        # Casos 1 y 2 (ΔG‡ > 0):
        # 1) ΔG‡ > 0 y Zact > 0  -> calcular Eckart como siempre
        # 2) ΔG‡ > 0 y Zact < 0  -> fijar factor de túnel = 1.0 (sin Eckart)
        if self.Gact > 0:
            if self.Zact > 0:
                self.CalcularTunel.calculate(
                    BARRZPE=self.Zact,
                    DELZPE=self.Zreact,
                    FREQ=abs(self.transition_rate.frecNeg.getValue),
                    TEMP=self.temp,
                )
            else:
                # Barrera ZPE ≤ 0 → sin Eckart
                self.CalcularTunel.Kappa = 1.0
                # opcional: calcular U solo para mostrarlo
                try:
                    freq = abs(self.transition_rate.frecNeg.getValue)
                    self.CalcularTunel.U = (
                        self.CalcularTunel.HPLANCK * self.CalcularTunel.CLUZ * freq
                    ) / (self.CalcularTunel.BOLZ * self.temp)
                except Exception:
                    pass
        else:
            # ΔG‡ ≤ 0 → TST no aplica
            self.warn_negative_Gact = True
            self.CalcularTunel.Kappa = 1.0  # valor neutro, pero no calculamos k
            self.rateCte = float("nan")
            return
        # tomar Kappa del objeto de túnel, con fallback
        self.Kappa = getattr(
            self.CalcularTunel, "Kappa", getattr(self.CalcularTunel, "kappa", 1.0)
        )

        self.rateCte: float = (
            self.degeneracy
            * self.Kappa
            * (2.08e10 * self.temp * exp(-self.Gact / (R_GAS_KCAL * self.temp)))
        )

        """
            If Diffusion is used:
        """
        if self.diffusion:
            # convertir Å → m
            rA_m = self.radius_1 * ANGSTROM_TO_M
            rB_m = self.radius_2 * ANGSTROM_TO_M
            Rrxn_m = self.reaction_distance * ANGSTROM_TO_M

            diffCoefA = (KB * self.temp) / (6 * PI * self.visc * rA_m)
            diffCoefB = (KB * self.temp) / (6 * PI * self.visc * rB_m)
            diffCoefAB = diffCoefA + diffCoefB

            # 4π D_AB R_rxn N_A; factor 1000 para pasar m^3 → L (M^-1 s^-1)
            kDiff = 1000 * 4 * PI * diffCoefAB * Rrxn_m * NA
            self.rateCte = (kDiff * self.rateCte) / (kDiff + self.rateCte)

    @property
    def visc(self) -> float:
        # Si el usuario seleccionó “Other” y proporcionó viscosidad válida
        if (
            (self.solvent or "").strip().lower() == "other"
            and isinstance(self.visc_custom, (int, float))
            and not (self.visc_custom != self.visc_custom)
            and self.visc_custom > 0
        ):
            return float(self.visc_custom)

        # Caso contrario, mapeo estándar (Pa·s)
        if self.solvent == "Benzene":
            return 0.000604
        elif self.solvent == "Gas phase (Air)":
            return 0.000018
        elif self.solvent == "Pentyl ethanoate":
            return 0.000862
        elif self.solvent == "Water":
            return 0.000891
        else:
            return nan


class EasyRate:
    def __init__(self, master=None):
        self.Ejecuciones: list[Ejecucion] = list()
        self.master = Tk() if master is None else Toplevel(master)
        self._principal = ttk.Frame(self.master)
        ttk.setup_master(self.master)
        self.style = ThemedStyle(self.master)
        self._principal.pack(fill="both", expand=True, padx=5, pady=5)
        self.master.title("Easy Rate 2.0")
        self.master.resizable(True, True)
        self.master.geometry("1200x750")
        self.master.minsize(1100, 700)

        # Configurar grid para la ventana principal
        self._principal.columnconfigure(0, weight=0)  # Columna izquierda (inputs)
        self._principal.columnconfigure(1, weight=1)  # Columna derecha (resultados)
        self._principal.rowconfigure(0, weight=1)

        self.menu()
        self.style.set_theme("clearlooks")
        self.style.configure(".", background="#f0f0f0", font=("Helvetica", 11))
        self.style.configure("TCombobox", fieldbackground="#f0f0f0")
        # --- Estilos "card" y textos informativos ---
        self.style.configure("Card.TLabelframe", background="#f7f7f7")
        self.style.configure("Card.TLabelframe.Label", font=("Helvetica", 12, "bold"))
        self.style.configure(
            "Info.TLabel",
            foreground="#555555",
            background="#f7f7f7",
            font=("Helvetica", 10),
        )
        self.style.configure(
            "Small.TLabel", foreground="#666666", font=("Helvetica", 9)
        )

        # Crear las secciones con el nuevo layout
        self.seccion_leer_archivos()
        self.seccion_datos_2()
        self.seccion_diffusion()
        self.seccion_pantalla()

    def menu(self):
        menubar = Menu(self.master)
        filemenu = Menu(menubar, tearoff=0)
        filemenu.add_command(label="Save", command=self.on_save)
        filemenu.add_command(label="Exit", command=self._principal.quit)
        menubar.add_cascade(label="File", menu=filemenu)
        ayuda = Menu(menubar, tearoff=0)
        menubar.add_cascade(label="help", menu=ayuda)
        ayuda.add_command(label="About", command=self.about)
        self.master.config(menu=menubar)

    def seccion_leer_archivos(self):
        # Frame izquierdo que contiene todo el panel de entrada
        left_panel = ttk.Frame(self._principal)
        left_panel.grid(row=0, column=0, sticky="nsew", padx=(5, 10), pady=5)

        _seccion_leer_archivos = ttk.LabelFrame(
            left_panel, text="Data entry", style="Card.TLabelframe"
        )
        _seccion_leer_archivos.pack(fill="x", padx=5, pady=5)

        tabla = ttk.Frame(_seccion_leer_archivos)
        tabla.pack(fill="x", padx=10, pady=10)

        label_etiqueta_nombre = ttk.Label(tabla, text="Run title")
        label_etiqueta_nombre.grid(row=0, column=0, sticky="w", pady=5)
        self.Title: Entry = Entry(tabla, width=25)
        self.Title.insert(0, str("Title"))
        self.Title.grid(row=0, column=1, columnspan=2, sticky="ew", pady=5, padx=(5, 0))

        self.React_1: EntradaDato = EntradaDato(tabla)
        self.React_1.grid(row=1, column=0, columnspan=3, sticky="ew")
        self.React_1.Activar(etiqueta="React-1", command=self.def_react_1)

        self.React_2: EntradaDato = EntradaDato(tabla)
        self.React_2.grid(row=2, column=0, columnspan=3, sticky="ew")
        self.React_2.Activar(etiqueta="React-2 (If any)", command=self.def_react_2)

        self.transition_rate: EntradaDato = EntradaDato(tabla)
        self.transition_rate.grid(row=3, column=0, columnspan=3, sticky="ew")
        self.transition_rate.Activar(
            etiqueta="Transition state", command=self.deftransition_rate
        )

        self.Product_1: EntradaDato = EntradaDato(tabla)
        self.Product_1.grid(row=4, column=0, columnspan=3, sticky="ew")
        self.Product_1.Activar(etiqueta="Product-1", command=self.def_product_1)

        self.product_2: EntradaDato = EntradaDato(tabla)
        self.product_2.grid(row=5, column=0, columnspan=3, sticky="ew")
        self.product_2.Activar(etiqueta="Product-2 (If any)", command=self.defproduct_2)

        tabla.columnconfigure(1, weight=1)

    def _get_loaded_map(self):
        return {
            "React-1": self.React_1.get_Estructura_Seleccionada(),
            "React-2": self.React_2.get_Estructura_Seleccionada(),
            "Transition state": self.transition_rate.get_Estructura_Seleccionada(),
            "Product-1": self.Product_1.get_Estructura_Seleccionada(),
            "Product-2": self.product_2.get_Estructura_Seleccionada(),
        }

    def _assert_all_loaded(self) -> bool:
        loaded = self._get_loaded_map()
        missing = [name for name, val in loaded.items() if val is None]
        if missing:
            messagebox.showerror("Missing data", "Please load: " + ", ".join(missing))
            return False
        return True

    def _assert_minimum_loaded(self) -> bool:
        m = self._get_loaded_map()
        # TS es obligatorio
        if m["Transition state"] is None:
            messagebox.showerror("Missing data", "Please load: Transition state")
            return False
        # Al menos un reactivo
        if m["React-1"] is None and m["React-2"] is None:
            messagebox.showerror(
                "Missing data",
                "Please load at least one reactant (React-1 or React-2).",
            )
            return False
        # Al menos un producto
        if m["Product-1"] is None and m["Product-2"] is None:
            messagebox.showerror(
                "Missing data",
                "Please load at least one product (Product-1 or Product-2).",
            )
            return False
        return True

    def _thermo_ok(self, s: Estructura) -> bool:
        try:
            g = s.Thermal_Free_Energies.no_nan_value
            zpe = s.zpe.no_nan_value
            h = s.eH_ts.no_nan_value
            t = s.temp.getValue
            for v in (g, zpe, h, t):
                if v is None or (isinstance(v, float) and isnan(v)):
                    return False
            return True
        except Exception:
            return False

    def _imag_count(self, s: Estructura) -> int:
        try:
            mf = getattr(s, "multFreqs", None)
            # intenta contar si expone lista o contador
            for attr in ("count", "n", "num", "length"):
                if hasattr(mf, attr):
                    return int(getattr(mf, attr))
            for attr in ("values", "lista", "valores", "items"):
                if hasattr(mf, attr):
                    seq = getattr(mf, attr)
                    try:
                        return len(seq)
                    except Exception:
                        pass
            # fallback a frecNeg
            fn = s.frecNeg.getValue
            if fn is None or fn == 0:
                return 0
            return 1 if fn < 0 else 0
        except Exception:
            return 0

    def _check_loaded(self, role: str, s: Estructura) -> bool:
        """
        role ∈ {"React-1","React-2","Product-1","Product-2","Transition state"}
        Reglas:
        - Todos: termo completa
        - React/Product: 0 imaginarias
        - TS: exactamente 1 imaginaria
        """
        if s is None:
            messagebox.showerror("Missing data", f"Please load {role}.")
            return False
        if not self._thermo_ok(s):
            messagebox.showerror(
                "Thermo missing",
                f"{role}: missing/invalid thermochemical data (G, ZPE, H or T).",
            )
            return False
        ic = self._imag_count(s)
        if role == "Transition state":
            if ic != 1:
                messagebox.showerror(
                    "Invalid TS",
                    f"Transition state must have exactly 1 imaginary frequency (found {ic}).",
                )
                return False
        else:
            if ic != 0:
                messagebox.showerror(
                    "Invalid structure",
                    f"{role} must have 0 imaginary frequencies (found {ic}).",
                )
                return False
        return True

    def def_react_1(self, estruct: Estructura):
        if not self._check_loaded("React-1", estruct):
            return
        # si llega aquí, ya es válido:
        self.Temperatura.delete(0, END)
        self.Temperatura.insert(0, str(estruct.temp.getValue))
        self.Temperatura["state"] = "disabled"
        self.React_1.setDato(un_dato=estruct.Thermal_Free_Energies.getValue)

    def def_react_2(self, estruct: Estructura):
        if not self._check_loaded("React-2", estruct):
            return
        self.React_2.setDato(un_dato=estruct.Thermal_Free_Energies.getValue)

    def deftransition_rate(self, estruct: Estructura):
        if not self._check_loaded("Transition state", estruct):
            return
        self.transition_rate.setDato(un_dato=estruct.Thermal_Free_Energies.getValue)

    def def_product_1(self, estruct: Estructura):
        if not self._check_loaded("Product-1", estruct):
            return
        self.Product_1.setDato(un_dato=estruct.Thermal_Free_Energies.getValue)

    def defproduct_2(self, estruct: Estructura):
        if not self._check_loaded("Product-2", estruct):
            return
        self.product_2.setDato(un_dato=estruct.Thermal_Free_Energies.getValue)

    def seccion_datos_2(self):
        # Obtener el panel izquierdo ya creado
        left_panel = self._principal.grid_slaves(row=0, column=0)[0]

        _seccion_datos_2 = ttk.LabelFrame(
            left_panel, text="Parameters", style="Card.TLabelframe"
        )
        _seccion_datos_2.pack(fill="x", padx=5, pady=5)

        frame_inner = ttk.Frame(_seccion_datos_2)
        frame_inner.pack(fill="x", padx=10, pady=10)

        # Tunneling
        ttk.Label(frame_inner, text="Tunneling").grid(
            column=0, row=0, sticky="w", padx=(0, 5), pady=5
        )
        ttk.Label(frame_inner, text="YES").grid(column=1, row=0, sticky="w")
        self.istunneling = IntVar()
        self.istunneling.set(1)
        ttk.Radiobutton(frame_inner, value=1, variable=self.istunneling).grid(
            column=2, row=0, sticky="w", padx=(5, 0)
        )

        self.Tunneling: Entry = Entry(frame_inner, width="10")
        self.Tunneling.grid(column=3, row=0, padx=(10, 0), pady=5, sticky="w")
        self.Tunneling["state"] = "disabled"

        # Temperature
        label_etiqueta_temperatura = ttk.Label(frame_inner, text="Temperature(K)")
        label_etiqueta_temperatura.grid(
            row=1, column=0, sticky="w", padx=(0, 5), pady=5
        )
        self.Temperatura: Entry = Entry(frame_inner, width="10")
        self.Temperatura.grid(row=1, column=3, sticky="w", padx=(10, 0), pady=5)
        self.Temperatura.insert(0, "298.15")

        # Degeneracy
        ttk.Label(frame_inner, text="Reaction path degeneracy").grid(
            column=0, row=2, sticky="w", padx=(0, 5), pady=5, columnspan=3
        )
        self.Reaction_path_degeneracy: Entry = Entry(frame_inner, width="10")
        self.Reaction_path_degeneracy.grid(
            column=3, row=2, sticky="w", padx=(10, 0), pady=5
        )
        self.Reaction_path_degeneracy.insert(0, "1")

        frame_inner.columnconfigure(3, weight=1)

    def _on_solvent_change(self, _event=None):
        # habilita el campo de viscosidad solo si eligen "Other" y Diffusion = YES
        if self.diffusion.get() == 1 and self.solvent.get().strip().lower() == "other":
            self.entry_visc.config(state="normal")
        else:
            self.entry_visc.config(state="disabled")

    def seccion_diffusion(self):
        # Obtener el panel izquierdo ya creado
        left_panel = self._principal.grid_slaves(row=0, column=0)[0]

        cont = ttk.LabelFrame(
            left_panel, text="Diffusion (optional)", style="Card.TLabelframe"
        )
        cont.pack(fill="x", padx=5, pady=5)
        # fila 0: toggle
        row = 0
        self.diffusion = IntVar(value=0)
        ttk.Label(cont, text="Do you want to consider diffusion?").grid(
            row=row, column=0, sticky="w", padx=10, pady=(10, 2)
        )
        ttk.Label(cont, text="Yes").grid(row=row, column=1, sticky="w")
        ttk.Radiobutton(
            cont, value=1, variable=self.diffusion, command=self.isdiffusion
        ).grid(row=row, column=1, sticky="w", padx=(35, 0))
        ttk.Label(cont, text="No").grid(row=row, column=1, sticky="w", padx=(70, 0))
        ttk.Radiobutton(
            cont, value=0, variable=self.diffusion, command=self.isdiffusion
        ).grid(row=row, column=1, sticky="w", padx=(95, 0))

        # Solvent
        row += 1
        ttk.Label(cont, text="Solvent").grid(
            row=row, column=0, sticky="w", padx=10, pady=(8, 2)
        )
        self.solvent = ttk.Combobox(cont, state="disabled", width=18)
        self.solvent.grid(row=row, column=1, columnspan=2, sticky="w", pady=(8, 2))
        values = list(self.solvent["values"])
        # agrega “Other” al final
        self.solvent["values"] = values + [
            "",
            "Benzene",
            "Gas phase (Air)",
            "Pentyl ethanoate",
            "Water",
            "Other",
        ]
        self.solvent.bind("<<ComboboxSelected>>", self._on_solvent_change)

        # Custom viscosity (Pa·s) – solo cuando solvent == "Other"
        row += 1
        ttk.Label(cont, text="Viscosity (Pa·s) (If other)").grid(
            row=row, column=0, sticky="w", padx=10, pady=(2, 2)
        )
        self.entry_visc = Entry(cont, width=10, state="disabled")
        self.entry_visc.grid(row=row, column=1, sticky="w", pady=(2, 2))

        # Radii and Rxn distance
        row += 1
        ttk.Label(cont, text="Radius (Å) — Reactant-1").grid(
            row=row, column=0, sticky="w", padx=10, pady=(6, 2)
        )
        self.radius_react_1 = Entry(cont, width=10, state="disabled")
        self.radius_react_1.grid(row=row, column=1, sticky="w", pady=(6, 2))

        row += 1
        ttk.Label(cont, text="Radius (Å) — Reactant-2").grid(
            row=row, column=0, sticky="w", padx=10, pady=(6, 2)
        )
        self.radius_react_2 = Entry(cont, width=10, state="disabled")
        self.radius_react_2.grid(row=row, column=1, sticky="w", pady=(6, 2))

        row += 1
        ttk.Label(cont, text="Reaction distance (Å)").grid(
            row=row, column=0, sticky="w", padx=10, pady=(2, 10)
        )
        self.reaction_distance = Entry(cont, width=10, state="disabled")
        self.reaction_distance.grid(row=row, column=1, sticky="w", pady=(2, 10))

        for c in range(4):
            cont.columnconfigure(c, weight=1)

    def isdiffusion(self):
        if self.diffusion.get() == 1:
            self.reaction_distance["state"] = "normal"
            self.radius_react_1["state"] = "normal"
            self.radius_react_2["state"] = "normal"
            self.solvent["state"] = "normal"
            self.style.configure("TCombobox", fieldbackground="white")
            # Si Other pide viscosidad
            if self.solvent.get().strip().lower() == "other":
                self.entry_visc.config(state="normal")
            else:
                self.entry_visc.config(state="disabled")
        else:
            self.radius_react_1["state"] = "disabled"
            self.radius_react_2["state"] = "disabled"
            self.reaction_distance["state"] = "disabled"
            self.solvent["state"] = "disabled"
            self.entry_visc.config(state="disabled")
            self.style.configure("TCombobox", fieldbackground="#f0f0f0")

    def clear_results(self):
        try:
            self.salida.delete("1.0", END)
        except Exception:
            pass

    def clear_details(self):
        try:
            self.salida2.delete("1.0", END)
        except Exception:
            pass

    def clear_both(self):
        self.clear_results()
        self.clear_details()

    def _show_clear_menu(self, widget):
        # Muestra el menú justo debajo del botón
        try:
            x = widget.winfo_rootx()
            y = widget.winfo_rooty() + widget.winfo_height()
            self._clear_menu.tk_popup(x, y)
        finally:
            self._clear_menu.grab_release()

    def seccion_pantalla(self):
        # Panel derecho para resultados
        right_panel = ttk.Frame(self._principal)
        right_panel.grid(row=0, column=1, sticky="nsew", padx=5, pady=5)
        right_panel.rowconfigure(2, weight=1)  # La sección de resultados se expande
        right_panel.columnconfigure(0, weight=1)

        # Frame superior con opciones
        top_frame = ttk.Frame(right_panel)
        top_frame.grid(row=0, column=0, sticky="ew", pady=(0, 5))

        # Cage Effects
        self.cage_efects = IntVar()
        self.cage_efects.set(0)
        cage_frame = ttk.Frame(top_frame)
        cage_frame.pack(side="left", padx=(10, 20))
        ttk.Label(cage_frame, text="Cage Effects?").pack(side="left", padx=(0, 5))
        ttk.Label(cage_frame, text="Yes").pack(side="left", padx=(5, 0))
        ttk.Radiobutton(cage_frame, value=1, variable=self.cage_efects).pack(
            side="left"
        )
        ttk.Label(cage_frame, text="No").pack(side="left", padx=(5, 0))
        ttk.Radiobutton(cage_frame, value=0, variable=self.cage_efects).pack(
            side="left"
        )

        # Print data
        self.print_data = IntVar()
        self.print_data.set(0)
        print_frame = ttk.Frame(top_frame)
        print_frame.pack(side="left", padx=(0, 20))
        ttk.Label(print_frame, text="Print data input?").pack(side="left", padx=(0, 5))
        ttk.Label(print_frame, text="Yes").pack(side="left", padx=(5, 0))
        ttk.Radiobutton(print_frame, value=1, variable=self.print_data).pack(
            side="left"
        )
        ttk.Label(print_frame, text="No").pack(side="left", padx=(5, 0))
        ttk.Radiobutton(print_frame, value=0, variable=self.print_data).pack(
            side="left"
        )

        # Botones de acción
        button_frame = ttk.Frame(right_panel)
        button_frame.grid(row=1, column=0, sticky="ew", pady=5)

        boton = ttk.Button(button_frame, text="Data ok, Run", command=self.run_calc)
        boton.pack(side="left", padx=(10, 10))

        clear_btn = ttk.Button(
            button_frame, text="Clear", command=lambda: self._show_clear_menu(clear_btn)
        )
        clear_btn.pack(side="left", padx=(0, 10))

        # Menú emergente para elegir qué limpiar
        self._clear_menu = Menu(right_panel, tearoff=0)
        self._clear_menu.add_command(
            label="Clear Results (left)", command=self.clear_results
        )
        self._clear_menu.add_command(
            label="Clear Details (right)", command=self.clear_details
        )
        self._clear_menu.add_separator()
        self._clear_menu.add_command(label="Clear Both", command=self.clear_both)

        # Área de resultados
        self._scrolle_pantalla(right_panel)

        # Tarjeta informativa compacta
        info = ttk.LabelFrame(right_panel, text="Notes", style="Card.TLabelframe")
        info.grid(row=3, column=0, sticky="ew", pady=(5, 0))
        info_inner = ttk.Frame(info)
        info_inner.pack(fill="x", padx=8, pady=8)
        ttk.Label(
            info_inner,
            text="Rate constant units:\n• Bimolecular:  M⁻¹ s⁻¹\n• Unimolecular: s⁻¹",
            style="Info.TLabel",
            justify="left",
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))
        ttk.Separator(info_inner, orient="vertical").grid(
            row=0, column=1, sticky="ns", padx=4
        )
        ttk.Label(
            info_inner,
            text="pH effects are not considered.\nSee About ▸ Equations for details.",
            style="Info.TLabel",
            justify="left",
        ).grid(row=0, column=2, sticky="w", padx=(8, 0))
        info_inner.columnconfigure(0, weight=1)
        info_inner.columnconfigure(2, weight=1)

    def _scrolle_pantalla(self, parent_frame):
        frame_resultados = ttk.Frame(parent_frame)
        frame_resultados.grid(row=2, column=0, sticky="nsew", pady=5)
        frame_resultados.columnconfigure(0, weight=1)
        frame_resultados.columnconfigure(1, weight=1)
        frame_resultados.rowconfigure(0, weight=1)

        # --- Left: Results (summary) ---
        left = ttk.LabelFrame(
            frame_resultados, text="Results (summary)", style="Card.TLabelframe"
        )
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(0, weight=1)

        self.salida = ScrolledText(left, wrap="none", width=35, height=25)
        self.salida.grid(row=0, column=0, sticky="nsew", padx=5, pady=5)

        # Scroll horizontal Results
        xsb_left = Scrollbar(left, orient="horizontal", command=self.salida.xview)
        self.salida.configure(xscrollcommand=xsb_left.set)
        xsb_left.grid(row=1, column=0, sticky="ew", padx=5, pady=(0, 5))

        self.salida.bind("<Key>", lambda e: "break")  # read-only

        # --- Right: Details ---
        right = ttk.LabelFrame(
            frame_resultados, text="Details", style="Card.TLabelframe"
        )
        right.grid(row=0, column=1, sticky="nsew", padx=(5, 0))
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=1)

        self.salida2 = ScrolledText(right, wrap="none", width=35, height=25)
        self.salida2.grid(row=0, column=0, sticky="nsew", padx=5, pady=5)

        # Scroll horizontal Details
        xsb_right = Scrollbar(right, orient="horizontal", command=self.salida2.xview)
        self.salida2.configure(xscrollcommand=xsb_right.set)
        xsb_right.grid(row=1, column=0, sticky="ew", padx=5, pady=(0, 5))

        self.salida2.bind("<Key>", lambda e: "break")  # read-only

    def _flash_invalid(self, widget, ms=1200):
        """Pinta el Entry en rojo temporalmente para señalar error."""
        try:
            orig = widget.cget("background")
        except Exception:
            orig = "white"
        widget.config(background="#ffecec")
        widget.after(ms, lambda: widget.config(background=orig))

    def _require_pos_float(self, widget, label, errors):
        """Lee float > 0 de un Entry. Si falla, agrega a 'errors' y marca el campo."""
        s = widget.get().strip()
        if not s:
            errors.append(f"{label} (empty)")
            self._flash_invalid(widget)
            return None
        try:
            v = float(s)
            if v <= 0:
                errors.append(f"{label} (must be > 0)")
                self._flash_invalid(widget)
                return None
            return v
        except Exception:
            errors.append(f"{label} (not a number)")
            self._flash_invalid(widget)
            return None

    def _append_input_summary(self, ej, text_widget):
        """
        Escribe un resumen de los datos de entrada en el text_widget indicado
        (p. ej. self.salida2 para 'Details').
        """
        def fmt(v):
            try: return f"{float(v):.6g}"
            except Exception: return str(v)

        def maybe_file(lbl):
            try:
                t = lbl.cget("text")
                return (f" [{t}]" if t else "")
            except Exception:
                return ""

        text_widget.insert(END, "=== Input summary ===\n")

        R1, R2, TS, P1, P2 = ej.React_1, ej.React_2, ej.transition_rate, ej.Product_1, ej.product_2
        text_widget.insert(END, f"Pathway title: {ej.title}\n\n")

        text_widget.insert(END, "Species (Thermal Free Enthalpy, ZPE, eH):\n")
        text_widget.insert(END, f"  React-1{maybe_file(self.React_1.labelEtiquetafilename)}"
                                f"  G={fmt(R1.Thermal_Free_Energies.no_nan_value)},"
                                f"  ZPE={fmt(R1.zpe.no_nan_value)},"
                                f"  eH={fmt(R1.eH_ts.no_nan_value)}\n")
        text_widget.insert(END, f"  React-2{maybe_file(self.React_2.labelEtiquetafilename)}"
                                f"  G={fmt(R2.Thermal_Free_Energies.no_nan_value)},"
                                f"  ZPE={fmt(R2.zpe.no_nan_value)},"
                                f"  eH={fmt(R2.eH_ts.no_nan_value)}\n")
        text_widget.insert(END, f"  TS     {maybe_file(self.transition_rate.labelEtiquetafilename)}"
                                f"  G={fmt(TS.Thermal_Free_Energies.getValue)},"
                                f"  ZPE={fmt(TS.zpe.getValue)},"
                                f"  eH={fmt(TS.eH_ts.getValue)},"
                                f"  |ν‡|={fmt(abs(TS.frecNeg.getValue))} cm⁻¹\n")
        text_widget.insert(END, f"  Prod-1 {maybe_file(self.Product_1.labelEtiquetafilename)}"
                                f"  G={fmt(P1.Thermal_Free_Energies.no_nan_value)},"
                                f"  ZPE={fmt(P1.zpe.no_nan_value)},"
                                f"  eH={fmt(P1.eH_ts.no_nan_value)}\n")
        text_widget.insert(END, f"  Prod-2 {maybe_file(self.product_2.labelEtiquetafilename)}"
                                f"  G={fmt(P2.Thermal_Free_Energies.no_nan_value)},"
                                f"  ZPE={fmt(P2.zpe.no_nan_value)},"
                                f"  eH={fmt(P2.eH_ts.no_nan_value)}\n\n")

        text_widget.insert(END, "Conditions & options:\n")
        text_widget.insert(END, f"  Temperature (K): {fmt(ej.temp)}\n")
        text_widget.insert(END, f"  Tunneling:       YES (κ computed by CK.tst)\n")
        text_widget.insert(END, f"  Degeneracy:      {fmt(ej.degeneracy)}\n")
        text_widget.insert(END, f"  Cage effects:    {'YES' if ej.cage_efects else 'NO'}\n")

        if ej.diffusion:
            text_widget.insert(END, "  Diffusion:       YES\n")
            text_widget.insert(END, f"    Solvent:       {ej.solvent or '(not specified)'}\n")
            text_widget.insert(END, f"    Radius R1 (Å): {fmt(ej.radius_1)}\n")
            text_widget.insert(END, f"    Radius R2 (Å): {fmt(ej.radius_2)}\n")
            text_widget.insert(END, f"    Rxn dist (Å):  {fmt(ej.reaction_distance)}\n")
        else:
            text_widget.insert(END, "  Diffusion:       NO\n")

        text_widget.insert(END, "======================\n\n")

    def run_calc(self):
        # 1) Asegurar que TODOS los archivos están cargados
        if not self._assert_minimum_loaded():
            return

        # --- Si Diffusion = YES, obliga solvente + radios + distancia > 0 ---
        if self.diffusion.get() == 1:
            errors = []

            # solvente obligatorio (no vacío)
            if not self.solvent.get().strip():
                errors.append("Solvent")

            # números > 0 (usa tu helper; devuelve float o None)
            r1 = self._require_pos_float(self.radius_react_1, "Radius — Reactant-1 (Å)", errors)
            r2 = self._require_pos_float(self.radius_react_2, "Radius — Reactant-2 (Å)", errors)
            rr = self._require_pos_float(self.reaction_distance, "Reaction distance (Å)", errors)

            #Si solvente es "Other", pedir viscosidad en Pa * s 
            self._visc_custom = float("nan")
            if self.solvent.get().strip().lower() == "other":
                v = self._require_pos_float(self.entry_visc, "Viscosity (Pa·s)",errors)
                if v is not None:
                    self._visc_custom = v

            if errors:
                messagebox.showerror(
                    "Missing/invalid diffusion data",
                    "Please provide valid values for:\n- " + "\n- ".join(errors)
                )
                return

            # guarda los floats ya validados para usarlos al crear la Ejecucion
            self._diff_r1 = r1
            self._diff_r2 = r2
            self._diff_rr = rr
        else:
            # si no hay difusión, valores 0 “inocuos”
            self._diff_r1 = 0.0
            self._diff_r2 = 0.0
            self._diff_rr = 0.0
            self._visc_custom = float("nan")

        # Si ya validas al cargar, aquí asumimos que todas las estructuras están OK.

        ejecucion_actual = Ejecucion(
            str(self.Title.get()),
            self.React_1.get_Estructura_Seleccionada(),
            self.React_2.get_Estructura_Seleccionada(),
            self.transition_rate.get_Estructura_Seleccionada(),
            self.Product_1.get_Estructura_Seleccionada(),
            self.product_2.get_Estructura_Seleccionada(),
            self.cage_efects.get() == 1,
            self.diffusion.get() == 1,
            self.solvent.get(),
            self._diff_r1,
            self._diff_r2,
            self._diff_rr,
            float(self.Reaction_path_degeneracy.get() or "0"),
            self.print_data.get() == 1,
            # nuevo argumento:
            visc_custom=self._visc_custom
        )
        try:
            ejecucion_actual.run()
        except exception_tunnel as e:
            from tkinter import messagebox
            messagebox.showerror("TST not applicable", str(e))
            return
        except Exception as e:
            from tkinter import messagebox
            messagebox.showerror("Run error", str(e))
            return

        # Advertencia si ΔG‡ < 0 (tu requisito)
        if getattr(ejecucion_actual, "warn_negative_Gact", False):
            from tkinter import messagebox
            messagebox.showwarning(
                "Negative free-energy barrier",
                "ΔG‡ is negative for this pathway.\n"
                "Conventional TST can't be used for this mechanism."
            )

       # Si marcaron "Print data input? = Yes", manda el resumen a Details
        if self.print_data.get() == 1:
            # opcional: limpiar primero Details
            # self.salida2.delete('1.0', END)
            self._append_input_summary(ejecucion_actual, self.salida2)

        self.salida.insert(
            END, ("Pathway:  " + ejecucion_actual.pathway + "\n"))
        self.salida.insert(END, ("Gibbs Free Energy of \n\treaction (kcal/mol):   "
                                 + str(round(ejecucion_actual.Greact, 2)) + "\n\n"))
        self.salida.insert(END, ("Gibbs Free Energy of \n\tactivation "
                                 + ("with cage effects \n\t"if(ejecucion_actual.cage_efects)else "") +
                                 " (kcal/mol):   "
                                 + str(round(ejecucion_actual.Gact, 2)) + "\n\n"))
        self.salida.insert(END, ("Rate Constant "+("\n\twith cage effects "if(ejecucion_actual.cage_efects)else "") + ":    "
                                 + "{:.2e}".format(ejecucion_actual.rateCte) + "\n\n"))
        
        self.salida.insert(
            END, ("ALPH1:" + str(round(ejecucion_actual.CalcularTunel.ALPH1, 2)) + "\n"))
        self.salida.insert(
            END, ("ALPH2:" + str(round(ejecucion_actual.CalcularTunel.ALPH2, 2)) + "\n"))
        self.salida.insert(
            END, ("u:" + str(round(ejecucion_actual.CalcularTunel.U, 2)) + "\n"))
        self.salida.insert(
            END, ("Kappa:" + str(round(ejecucion_actual.CalcularTunel.Kappa, 2)) + "\n"))
        self.salida.insert(END, ("_____________________________\n"))
        self.salida2.insert(
            END, ("Pathway:  " + str(ejecucion_actual.pathway) + "\n"))
        self.salida2.insert(END, ("Imag. Freq. (cm-1):  \t\t\t"
                                  + str(round(ejecucion_actual.frequency_negative, 2)) + "\n\n"))
        self.salida2.insert(END, ("Reaction enthalpies (dH)" + "\n"))
        self.salida2.insert(END, ("\tdH reaction (kcal/mol):  \t"
                                  + str(round(ejecucion_actual.dH_react, 2)) + "\n"))
        self.salida2.insert(END, ("\tdH activation (kcal/mol):\t"
                                  + str(round(ejecucion_actual.dHact, 2)) + "\n\n"))
        self.salida2.insert(END, ("Reaction ZPE (dZPE)  " + "\n"))
        self.salida2.insert(END, ("\tdZPE reaction (kcal/mol):  \t"
                                  + str(round(ejecucion_actual.Zreact, 2)) + "\n"))
        self.salida2.insert(END, ("\tdZPE activation (kcal/mol):\t"
                                  + str(round(ejecucion_actual. Zact, 2)) + "\n\n"))
        self.salida2.insert(END, ("Temperature (K):  " + str(round(ejecucion_actual.temp, 2))
                            + ("\n\n"if(ejecucion_actual.cage_efects)else "") + "\n\n"))
        self.salida2.insert(END, ("______________________________________\n"))
        self.Ejecuciones.append(ejecucion_actual)
        self.Tunneling['state'] = "normal"
        self.Tunneling.insert(0, " ")
        self.Tunneling.delete(0, END)
        self.Tunneling.insert(
            0, str(round(ejecucion_actual.CalcularTunel.Kappa, 2)))
        self.Tunneling['state'] = "readonly"

    def about(self):
        import webbrowser
        from io import BytesIO

        # --- Rendering LaTeX-like formulas via Matplotlib mathtext (portable) ---
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from PIL import Image, ImageTk

        # ---------- Window ----------
        window = Toplevel(self.master)
        window.title("About • Easy Rate")
        window.resizable(True, True)
        window.geometry("700x600")
        window.minsize(500, 200)
        window.transient(self.master)
        window.grab_set()

        root = ttk.Frame(window, padding=12)
        root.grid(sticky="nsew")
        window.columnconfigure(0, weight=1)
        window.rowconfigure(0, weight=1)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(3, weight=1)

        # ---------- Header ----------
        header = ttk.Frame(root)
        header.grid(row=0, column=0, sticky="ew")
        ttk.Label(header, text="Easy Rate", font=("Helvetica", 18, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(header, text="Version 2.0", font=("Helvetica", 11)).grid(row=0, column=1, sticky="e")
        header.columnconfigure(0, weight=1)
        ttk.Separator(root).grid(row=1, column=0, sticky="ew", pady=(6, 8))

        # ---------- Notebook (tabs) ----------
        nb = ttk.Notebook(root)
        nb.grid(row=2, column=0, sticky="nsew", pady=(0, 6))

        # Helpers: create a styled ScrolledText
        def make_text(parent, font=("Helvetica", 13)):
            w = ScrolledText(parent, wrap="word", width=100, height=20)
            w.configure(font=font, spacing1=2, spacing3=4)  # compact spacing before/after paragraphs
            # Keep images referenced per-widget
            w._eq_imgs = []
            return w

        # Math renderer
        def render_math_to_photoimage(tex: str, dpi=170, pad_px=1, fontsize=10):
            tex = tex.replace(r"\ddagger", "‡")   # mathtext compatibility
            tex = tex.replace(r"\text{", r"\mathrm{")
            fig = plt.figure(figsize=(0.01, 0.01), dpi=dpi)
            fig.patch.set_alpha(0)
            ax = fig.add_subplot(111)
            ax.axis("off")
            ax.text(0.5, 0.5, tex, fontsize=7, ha="center", va="center")
            fig.tight_layout(pad=pad_px/72)
            buf = BytesIO()
            fig.savefig(buf, format="png", transparent=True, dpi=dpi, bbox_inches="tight")
            plt.close(fig)
            buf.seek(0)
            im = Image.open(buf)
            return ImageTk.PhotoImage(im)

        def insert_eq(text_widget: ScrolledText, tex: str, newlines: int = 1):
            img = render_math_to_photoimage(tex, pad_px=1, fontsize=7)
            text_widget._eq_imgs.append(img)   # prevent GC
            text_widget.image_create("end", image=img)
            text_widget.insert("end", "\n" * newlines)

        # ---------- TAB 1: Overview ----------
        tab_over = ttk.Frame(nb, padding=(8, 8))
        nb.add(tab_over, text="Overview")
        txt_over = make_text(tab_over)
        txt_over.grid(sticky="nsew")
        tab_over.columnconfigure(0, weight=1)
        tab_over.rowconfigure(0, weight=1)
        txt_over.insert("end",
            "Easy Rate is a scientific interface that estimates reaction rate constants from quantum-chemical data. "
            "It parses Gaussian output files (.log/.out) to extract thermochemical quantities and computes:\n"
            " • Reaction Gibbs free energy (ΔG)\n"
            " • Activation Gibbs free energy (ΔG‡)\n"
            " • Rate constants via Transition State Theory (TST / Eyring), with a tunneling correction (CK.tst)\n"
            "Optional corrections include cage effects and the diffusion-controlled limit (Smoluchowski) for bimolecular processes.\n\n"
            "Key Inputs per species\n"
            " • Thermal free enthalpies (G), Zero-point energies (ZPE)\n"
            " • Imaginary frequency of the transition state (|ν‡|)\n"
            " • Temperature (K)\n\n"
            "Notes\n"
            " • Gaussian energies are converted as needed (commonly 1 Hartree = 627.5095 kcal·mol⁻¹).\n"
            " • κ (tunneling factor) is computed by the CK.tst module from |ν‡| and the ZPE-corrected barrier.\n"
        )
        txt_over.configure(state="disabled")

        # ---------- TAB 2: Equations ----------
        tab_eq = ttk.Frame(nb, padding=(8, 8))
        nb.add(tab_eq, text="Equations")
        txt_eq = make_text(tab_eq)
        txt_eq.grid(sticky="nsew")
        tab_eq.columnconfigure(0, weight=1)
        tab_eq.rowconfigure(0, weight=1)

        txt_eq.insert("end", "Eyring (TST):\n")
        insert_eq(txt_eq, r"$k_{\mathrm{TST}} \;=\; \kappa \,\frac{k_B\,T}{h}\,\exp\!\left(-\frac{\Delta G^{‡}}{R\,T}\right)$")

        txt_eq.insert("end", "Standard-state correction (1 M):\n")
        insert_eq(txt_eq, r"$\Delta G_{\mathrm{corr}} \;=\; R\,T \,\ln\!\left(V_m^{\,\Delta \nu}\right),\qquad V_m \approx 0.08206\,T$")

        txt_eq.insert("end", "Diffusion and effective rate (bimolecular):\n")
        insert_eq(txt_eq, r"$D_i \;=\; \frac{k_B\,T}{6\pi\,\eta\,r_i},\quad D_{AB}=D_A+D_B$")
        insert_eq(txt_eq, r"$k_{\mathrm{diff}} \;=\; 4\pi\,N_A\,D_{AB}\,R_{\mathrm{rxn}}\cdot 1000$")
        insert_eq(txt_eq, r"$k_{\mathrm{eff}} \;=\; \frac{k_{\mathrm{diff}}\;k_{\mathrm{TST}}}{k_{\mathrm{diff}}+k_{\mathrm{TST}}}$")

        txt_eq.configure(state="disabled")

        # ---------- TAB 3: Citations & Funding ----------
        tab_cit = ttk.Frame(nb, padding=(8, 8))
        nb.add(tab_cit, text="Citations & Funding")
        txt_cit = make_text(tab_cit)
        txt_cit.grid(sticky="nsew")
        tab_cit.columnconfigure(0, weight=1)
        tab_cit.rowconfigure(0, weight=1)

        citations = (
            "How to Cite (required for publications using Easy Rate)\n\n"
            "I) CADMA-Chem:\n"
            "   Guzman-Lopez, E.G.; Reina, M.; Perez-Gonzalez, A.; Francisco-Marquez, M.; Hernandez-Ayala, L.F.; "
            "Castañeda-Arriaga, R.; Galano, A. CADMA-Chem: A Computational Protocol Based on Chemical Properties Aimed to Design "
            "Multifunctional Antioxidants. Int. J. Mol. Sci. 2022, 23, 13246. https://doi.org/10.3390/ijms232113246\n\n"
            "II) QM-ORSA methodology:\n"
            "   Galano, A.; Alvarez-Idaboy, J.R. A computational methodology for accurate predictions of rate constants in solution: "
            "application to the assessment of primary antioxidant activity. J. Comput. Chem. 2013, 34(28), 2430–2445. "
            "https://onlinelibrary.wiley.com/doi/10.1002/jcc.23409  (doi:10.1002/jcc.23409)\n\n"
            "Funding\n"
            " • Supported by the Basic and Frontier Science Project CBF2023-2024-1141.\n"
        )
        txt_cit.insert("end", citations)
        txt_cit.configure(state="disabled")

        # ---------- TAB 4: Contacts & Links ----------
        tab_links = ttk.Frame(nb, padding=(8, 8))
        nb.add(tab_links, text="Contacts & Links")
        txt_links = make_text(tab_links)
        txt_links.grid(sticky="nsew")
        tab_links.columnconfigure(0, weight=1)
        tab_links.rowconfigure(0, weight=1)

        links = (
            "Developers & Contact\n"
            " • César Gerardo Guzmán López   —  cesar-gerardo@guzman-lopez.com\n"
            " • Eduardo Gabriel Guzmán López —  eggl.quimica@gmail.com\n"
            " • Annia Galano                      \t\t     —  annia.galano@gmail.com\n\n"
            "Repository\n"
            " • https://github.com/CesarGuzmanLopez/Apps-Annia\n"
        )
        txt_links.insert("end", links)
        txt_links.configure(state="disabled")

        # ---------- Footer (actions) ----------
        footer = ttk.Frame(root)
        footer.grid(row=3, column=0, sticky="ew")
        for i in range(6):
            footer.columnconfigure(i, weight=1)

        def open_repo(): webbrowser.open_new("https://github.com/CesarGuzmanLopez/Apps-Annia")
        def open_cadma(): webbrowser.open_new("https://doi.org/10.3390/ijms232113246")
        def open_qm_orsa(): webbrowser.open_new("https://onlinelibrary.wiley.com/doi/10.1002/jcc.23409")

        def copy_citations():
            cites = (
                "Please cite:\n"
                "1) Guzman-Lopez, E.G.; Reina, M.; Perez-Gonzalez, A.; Francisco-Marquez, M.; Hernandez-Ayala, L.F.; "
                "Castañeda-Arriaga, R.; Galano, A. CADMA-Chem: A Computational Protocol Based on Chemical Properties Aimed "
                "to Design Multifunctional Antioxidants. Int. J. Mol. Sci. 2022, 23, 13246. https://doi.org/10.3390/ijms232113246\n"
                "2) Galano, A.; Alvarez-Idaboy, J.R. A computational methodology for accurate predictions of rate constants in solution: "
                "application to the assessment of primary antioxidant activity. J. Comput. Chem. 2013, 34(28), 2430–2445. "
                "doi:10.1002/jcc.23409\n"
            )
            window.clipboard_clear(); window.clipboard_append(cites)
            messagebox.showinfo("Copied", "Citation text copied to clipboard.")

        def copy_contacts():
            contacts = (
                "Contacts:\n"
                "César:    cesar-gerardo@guzman-lopez.com\n"
                "Gabriel:  eggl.quimica@gmail.com\n"
                "Annia:    annia.galano@gmail.com\n"
            )
            window.clipboard_clear(); window.clipboard_append(contacts)
            messagebox.showinfo("Copied", "Contact e-mails copied to clipboard.")

        ttk.Button(footer, text="Open Repository", command=open_repo).grid(row=0, column=0, sticky="w")
        ttk.Button(footer, text="Open CADMA-Chem", command=open_cadma).grid(row=0, column=1, sticky="w", padx=(8, 0))
        ttk.Button(footer, text="Open QM-ORSA", command=open_qm_orsa).grid(row=0, column=2, sticky="w", padx=(8, 0))
        ttk.Button(footer, text="Copy Citations", command=copy_citations).grid(row=0, column=3, sticky="w", padx=(8, 0))
        ttk.Button(footer, text="Copy Contacts", command=copy_contacts).grid(row=0, column=4, sticky="w", padx=(8, 0))
        ttk.Button(footer, text="Close", command=window.destroy).grid(row=0, column=5, sticky="e")

    def on_save(self):
        import os
        initial = LAST_DIR if (LAST_DIR and os.path.isdir(LAST_DIR)) else os.getcwd()
        file_path = filedialog.asksaveasfilename(
            initialdir=initial,
            filetypes=(("Text files", "*.txt"), ("All files", "*.*"))
        )
        if not file_path:
            return  # usuario canceló

        try:
            with open(file_path, "w", encoding="utf-8") as file:
                for ejecucion in self.Ejecuciones:
                    file.write("Pathway: "+ ejecucion.pathway + "\n")
                    if(ejecucion.PrintData):
                        file.write("Data entry: " + "\n")
                        file.write("\tReact 1:        :"+str(ejecucion.React_1.Thermal_Free_Energies.no_nan_value   ) + "\n")
                        file.write("\tReact 2:        :"+str(ejecucion.React_2.Thermal_Free_Energies.no_nan_value   ) + "\n")
                        file.write("\tTransition rate :"+str(ejecucion.transition_rate.Thermal_Free_Energies.getValue) + "\n")
                        file.write("\tProd 1          :"+str(ejecucion.Product_1.Thermal_Free_Energies.no_nan_value ) + "\n")
                        file.write("\tProd 2          :"+str(ejecucion.product_2.Thermal_Free_Energies.no_nan_value ) + "\n")
                        file.write("\tDegeneracy      :"+str(ejecucion.degeneracy) + "\n")
                    if(ejecucion.PrintData and ejecucion.diffusion):
                        file.write("\tDiffusion considered: \n") 
                        file.write("\t\tSolvent:        "+ ejecucion.solvent +  "\n")
                        file.write("\t\tRadius React-1: "+str(ejecucion.radius_1) + "\n")
                        file.write("\t\tRadius React-2: "+str(ejecucion.radius_2) + "\n")
                        file.write("\t\tRadius Reaction distance: "+ str(ejecucion.reaction_distance) + "\n")
                    if(ejecucion.PrintData):
                        file.write("\n\n")
                    file.write("Gibbs Free Energy of reaction (kcal/mol):\t\t"
                                + str(round(ejecucion.Greact, 2)) + "\n\n")
                    
                    file.write("Gibbs Free Energy of activation "
                                    + ("with cage effects "if(ejecucion.cage_efects)else "") +
                                    " (kcal/mol):\t"
                                    + str(round(ejecucion.Gact, 2)) + "\n\n")
                    
                    file.write("Rate Constant "+("with cage effects "if(ejecucion.cage_efects)else "") + ":    "
                                    + "{:.2e}".format(ejecucion.rateCte) + "\n\n")
                    
                    file.write("ALPH1:\t" + str(round(ejecucion.CalcularTunel.ALPH1, 2)) + "\n")  # ALPH1
                    
                    file.write("ALPH2:\t" + str(round(ejecucion.CalcularTunel.ALPH2, 2)) + "\n")  # ALPH2
                    
                    file.write("u:\t\t" + str(round(ejecucion.CalcularTunel.U, 2)) + "\n")  # u 
                    
                    file.write("Imag. Freq. (cm-1): \t"
                                    + str(round(ejecucion.frequency_negative, 2)) + "\n\n") 
                    
                    file.write("Reaction enthalpies (dH)" + "\n")
                    
                    file.write("\tdH reaction (kcal/mol):  \t"
                                    + str(round(ejecucion.dH_react, 2)) + "\n")
                    
                    file.write("\tdH activation (kcal/mol):\t"
                                    + str(round(ejecucion.dHact, 2)) + "\n\n")
                    
                    file.write("Reaction ZPE (dZPE)  " + "\n") 
                    
                    file.write("\tdZPE reaction (kcal/mol):  \t" 
                                    + str(round(ejecucion.Zreact, 2)) + "\n")   
                    
                    file.write("\tdZPE activation (kcal/mol):\t"
                                    + str(round(ejecucion. Zact, 2)) + "\n\n")  
                    
                    file.write("Temperature (K):  " + str(round(ejecucion.temp, 2))
                                    + ("\n\n") )    
                    file.write("______________________________________\n")

                file.close()

        except Exception as e:
            from tkinter import messagebox
            messagebox.showerror("Save error", str(e))
        
    def run(self):
        self._principal.mainloop()

if __name__ == '__main__':
    app = EasyRate()
    app.run()

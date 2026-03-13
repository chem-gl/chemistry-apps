from tkinter import Toplevel, Scrollbar, INSERT, N, S, E, W
from tkinter.scrolledtext import ScrolledText
from read_log_gaussian.Estructura import Estructura

def format_structure(e) -> str:
    """
    Devuelve un texto legible con bloques/secciones:
    - Summary
    - Thermochemistry
    - Frequencies
    - Termination
    - Orbitals (último set)
    Solo imprime campos que estén encontrados (_Found=True).
    """

    def has(obj, name):
        return getattr(obj, name, None)

    def found(attr) -> bool:
        try:
            return bool(getattr(attr, "_Found", False))
        except Exception:
            return False

    def val(x):
        try:
            return f"{float(x):.6f}"
        except Exception:
            return str(x)

    out = []

    # === Summary ===
    out.append("=== Summary ===")
    if has(e, "jobtitle") and found(e.jobtitle):
        try:
            out.append(f"Job Title: {str(e.jobtitle._Value).strip()}")
        except Exception:
            pass

    if has(e, "chargeMultiplicity") and found(e.chargeMultiplicity):
        try:
            ch = e.chargeMultiplicity._Value.Charge
            mult = e.chargeMultiplicity._Value.Multiplicity
            out.append(f"Charge / Multiplicity: {ch} / {mult}")
        except Exception:
            pass

    # === Thermochemistry ===
    thermo_lines = []
    if has(e, "SCF") and found(e.SCF):
        thermo_lines.append(f"SCF Energy: {val(e.SCF._Value)}  (Hartree)")
    if has(e, "zeroPointCorrection") and found(e.zeroPointCorrection):
        thermo_lines.append(f"Zero-point correction: {val(e.zeroPointCorrection._Value)}  (Hartree)")
    if has(e, "zpe") and found(e.zpe):
        thermo_lines.append(f"Sum elec + zero-point Energies: {val(e.zpe._Value)}  (Hartree)")
    if has(e, "eH_ts") and found(e.eH_ts):
        thermo_lines.append(f"Sum elec + thermal Enthalpies:  {val(e.eH_ts._Value)}  (Hartree)")
    if has(e, "Thermal_Free_Enthalpies") and found(e.Thermal_Free_Enthalpies):
        thermo_lines.append(f"Sum elec + thermal Free Energies (G): {val(e.Thermal_Free_Enthalpies._Value)}  (Hartree)")
    if has(e, "thermalCorrectionToEnergy") and found(e.thermalCorrectionToEnergy):
        thermo_lines.append(f"Thermal corr. to Energy:       {val(e.thermalCorrectionToEnergy._Value)}  (Hartree)")
    if has(e, "thermalcorrectiontoEnthalpy") and found(e.thermalcorrectiontoEnthalpy):
        thermo_lines.append(f"Thermal corr. to Enthalpy:     {val(e.thermalcorrectiontoEnthalpy._Value)}  (Hartree)")
    if has(e, "thermalCorrectionToGibbs") and found(e.thermalCorrectionToGibbs):
        thermo_lines.append(f"Thermal corr. to Gibbs:        {val(e.thermalCorrectionToGibbs._Value)}  (Hartree)")
    if has(e, "temp") and found(e.temp):
        try:
            thermo_lines.append(f"Temperature: {val(e.temp._Value)} K")
        except Exception:
            pass

    if thermo_lines:
        out.append("\n=== Thermochemistry ===")
        out.extend(thermo_lines)

    # === Frequencies ===
    freq_lines = []
    if has(e, "multFreqs") and found(e.multFreqs):
        try:
            cnt = int(e.multFreqs._Value)
            freq_lines.append(f"Imaginary frequencies (count): {cnt}")
        except Exception:
            pass
    if has(e, "frecNeg") and found(e.frecNeg):
        try:
            freq_lines.append(f"Imag. frequency (cm⁻¹): {val(e.frecNeg._Value)}")
        except Exception:
            pass

    if freq_lines:
        out.append("\n=== Frequencies ===")
        out.extend(freq_lines)

    # === Termination ===
    if has(e, "normalTerm") and found(e.normalTerm):
        out.append("\n=== Termination ===")
        out.append("Normal termination of Gaussian")

    # === Orbitals (last set) ===
    if has(e, "listaOrbitales") and found(e.listaOrbitales):
        try:
            orb = e.listaOrbitales.OrbitalactualUltimo
        except Exception:
            orb = None

        def block(title, nums):
            if not nums:
                return None
            # columnas de 5 en monoespaciado
            lines = [title]
            row = []
            for i, n in enumerate(nums, 1):
                try:
                    row.append(f"{float(n):>12.6f}")
                except Exception:
                    row.append(f"{str(n):>12}")
                if i % 5 == 0:
                    lines.append(" ".join(row)); row = []
            if row:
                lines.append(" ".join(row))
            return "\n".join(lines)

        parts = []
        if orb:
            if getattr(orb, "A", None):
                parts.append(block("Alpha  occ. eigenvalues:", orb.A))
            if getattr(orb, "AL", None):
                parts.append(block("Alpha virt. eigenvalues:", orb.AL))
            if getattr(orb, "B", None):
                parts.append(block("Beta   occ. eigenvalues:", orb.B))
            if getattr(orb, "BL", None):
                parts.append(block("Beta  virt. eigenvalues:", orb.BL))

        if parts:
            out.append("\n=== Orbitals (last set) ===")
            out.append("\n\n".join([p for p in parts if p]))

    return "\n".join(out).rstrip() + "\n"

def _mono_font():
    import platform
    sys = platform.system().lower()
    if "windows" in sys:
        return ("Consolas", 11)
    if "darwin" in sys:  # macOS
        return ("Menlo", 11)
    return ("DejaVu Sans Mono", 11)  # Linux

class ViewStructure:
    def __init__(self, master=None, estructure: Estructura = None):
        self.principal = Toplevel(master)
        self.principal.title("View structure")
        self.principal.resizable(True, True)

        # Tamaño y centrado
        w, h = 600, 650
        sw, sh = self.principal.winfo_screenwidth(), self.principal.winfo_screenheight()
        x, y = (sw - w) // 2, (sh - h) // 2
        self.principal.geometry(f"{w}x{h}+{x}+{y}")

        # Contenedor principal
        self.principal.columnconfigure(0, weight=1)
        self.principal.rowconfigure(0, weight=1)

        # Área de texto con scroll vertical y horizontal
        salida = ScrolledText(self.principal, wrap="none", font=_mono_font())
        salida.grid(row=0, column=0, sticky=N+S+E+W)

        xsb = Scrollbar(self.principal, orient="horizontal", command=salida.xview)
        salida.configure(xscrollcommand=xsb.set)
        xsb.grid(row=1, column=0, sticky=E+W)

        # Cargar estructura
        if estructure is not None:
            salida.insert(INSERT, format_structure(estructure))
            salida.configure(font=("Courier New", 14))  # monoespaciado ayuda a alinear columnas
            #salida.insert(INSERT, str(estructure))
        else:
            salida.insert(INSERT, "No structure loaded.")

        salida.configure(state="disabled")

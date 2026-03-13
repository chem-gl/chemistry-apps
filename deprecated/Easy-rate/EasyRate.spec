from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Soporta ejecución con/sin __file__
if '__file__' in globals():
    SPEC_PATH = Path(__file__).resolve()
else:
    SPEC_PATH = Path(sys.argv[0]).resolve() if sys.argv and sys.argv[0] else Path.cwd()

PROJ = SPEC_PATH.parent
ENTRY = str(PROJ / "main.py")

ICON = None  # <- SIN ICONO

hiddenimports = []
hiddenimports += collect_submodules("ttkthemes")
hiddenimports += collect_submodules("tkinter")

datas = []
datas += collect_data_files("ttkthemes", include_py_files=True)

block_cipher = None

a = Analysis(
    [ENTRY],
    pathex=[str(PROJ)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports + [
        "CK.tst",
        "read_log_gaussian.Estructura",
        "read_log_gaussian.read_log_gaussian",
        "tkdialog",
        "viewStructure",
        "SelectStructure",      # o "SeslectStructura" si ese es el nombre real del .py
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="EasyRate",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,      # GUI
    icon=ICON,
)

coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False, upx=False, upx_exclude=[], name="EasyRate",
)

app = BUNDLE(
    coll,
    name="EasyRate.app",
    icon=ICON,
    bundle_identifier="com.eggl.easyrate",
    info_plist={
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "11.0",
    },
)


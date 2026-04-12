"""chemistry_constants.py: Constantes físicas y de conversión para apps de química computacional.

Fuente: CODATA 2018 (https://physics.nist.gov/cuu/Constants/)
Objetivo: centralizar valores físicos compartidos entre apps para evitar divergencias.
Uso: importar directamente en cualquier app o lib que requiera estas constantes.
"""

from __future__ import annotations

# === CONSTANTE DE BOLTZMANN ===
# CODATA 2018: exacto, definición SI
KB: float = 1.380649e-23  # J/K

# === NÚMERO DE AVOGADRO ===
# CODATA 2018: exacto, definición SI
AVOGADRO: float = 6.02214076e23  # mol⁻¹

# === CONSTANTE DE LOS GASES IDEALES ===
# Derivada de KB * AVOGADRO
R_GAS: float = 8.314462618  # J/(mol·K)
R_GAS_KCAL: float = R_GAS / 4184.0  # kcal/(mol·K) ≈ 0.001987

# === CONVERSIÓN ENERGÉTICA ===
# 1 Hartree = 627.5094740631 kcal/mol (CODATA 2018)
HARTREE_TO_KCAL: float = 627.5095  # kcal/mol

# === CONSTANTES GEOMÉTRICAS Y DE CONVERSIÓN ===
ANGSTROM_TO_M: float = 1e-10  # m/Å

# === NOTA ===
# Estas constantes son exactas (definición SI) o con precisión CODATA 2018.
# Usar siempre estas constantes en lugar de definirlas localmente en cada app.

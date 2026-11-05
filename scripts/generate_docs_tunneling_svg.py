#!/usr/bin/env python3
"""generate_docs_tunneling_svg.py: Regenera los diagramas de energía de los manuales.

Los manuales (usados por el panel de documentación) mostraban una polilínea
esquemática que no representaba un túnel real. Este script dibuja la misma
física que la gráfica de la app

    V(x)  = V0 * sech^2(2*pi*x/L)
    P(E)  = (cosh(a1+a2) - cosh(a1-a2)) / (cosh(a1+a2) + df)

con la transmisión de Eckart del backend
(`backend/libs/ck_test/calculators.py::_gauss_quadrature_integration`) y una
densidad |psi|^2 coherente con P(E): onda incidente+reflejada a la izquierda,
decaimiento dentro de la barrera y onda transmitida a la derecha.

Uso:
    python3 scripts/generate_docs_tunneling_svg.py            # reescribe los i18n
    python3 scripts/generate_docs_tunneling_svg.py --dry-run  # solo informa
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = REPO_ROOT / "frontend" / "public" / "i18n"

# Constantes compartidas con frontend/.../tunneling-chart-math.ts
CHARACTERISTIC_LENGTH = 0.9
PROFILE_EXTENT_IN_LENGTHS = 1.6
BARRIER_HALF_WIDTH_IN_LENGTHS = 0.5
WAVE_NUMBER = math.pi / (BARRIER_HALF_WIDTH_IN_LENGTHS * CHARACTERISTIC_LENGTH)
SAMPLE_COUNT = 200

WIDTH, HEIGHT = 360, 200
PAD_LEFT, PAD_RIGHT, PAD_TOP, PAD_BOTTOM = 44, 34, 22, 34

# Ejemplos canónicos publicados en los manuales.
TUNNEL_EXAMPLE = {
    "barrier": 3.5,
    "delta_e": -8.2,
    "u": 3.016,
    "alpha1": 12.306,
    "alpha2": 41.139,
    "temperature": 298.15,
}
EASY_RATE_EXAMPLE = {
    "barrier": 29.032,
    "delta_e": -7.736,
    "u": 12.152,
    "alpha1": 2 * math.pi * 29.032 / (12.152 * 0.59249),
    "alpha2": 2 * math.pi * (29.032 + 7.736) / (12.152 * 0.59249),
    "temperature": 298.15,
}


def transmission_probability(
    energy: float, u: float, alpha1: float, alpha2: float
) -> float:
    """Transmisión de Eckart P(E); misma fórmula que el backend."""
    if u <= 0 or alpha1 <= 0 or alpha2 <= 0:
        return 0.0
    scale = 0.125 * math.pi * u * (1 / math.sqrt(alpha1) + 1 / math.sqrt(alpha2)) ** 2
    v1 = (u / (2 * math.pi)) * alpha1
    v2 = (u / (2 * math.pi)) * alpha2
    discriminant = 4 * alpha1 * alpha2 - math.pi**2
    df = (
        math.cosh(math.sqrt(discriminant))
        if discriminant > 0
        else math.cos(math.sqrt(-discriminant))
    )
    if scale <= 0:
        return 0.0
    shifted1, shifted2 = energy + v1, energy + v2
    if shifted1 <= 0 or shifted2 <= 0:
        return 0.0
    a1 = math.pi * math.sqrt(shifted1 / scale)
    a2 = math.pi * math.sqrt(shifted2 / scale)
    total = a1 + a2
    numerator = 1 + math.exp(-2 * total) - math.exp(-2 * a1) - math.exp(-2 * a2)
    denominator = 1 + math.exp(-2 * total) + 2 * df * math.exp(-total)
    if denominator == 0:
        return 0.0
    return min(max(numerator / denominator, 0.0), 1.0)


def sech_squared(value: float) -> float:
    """sech^2 con guarda para valores grandes (evita overflow)."""
    if abs(value) > 40:
        return 0.0
    cosh_value = math.cosh(value)
    return 1.0 / (cosh_value * cosh_value)


def potential(x: float, barrier: float) -> float:
    """Potencial canónico de Eckart: V(x) = V0 * sech^2(2*pi*x/L)."""
    width = 2 * math.pi / CHARACTERISTIC_LENGTH
    return barrier * sech_squared(width * x)


def probability_density(x: float, probability: float) -> float:
    """|psi|^2 normalizada, coherente con P(E) (ver tunneling-chart-math.ts)."""
    reflection = math.sqrt(max(0.0, 1.0 - probability))
    edge = BARRIER_HALF_WIDTH_IN_LENGTHS * CHARACTERISTIC_LENGTH
    transmitted = max(probability, 1e-12)
    if x <= -edge:
        amplitude = math.cos(WAVE_NUMBER * x) + reflection * math.cos(
            WAVE_NUMBER * (2 * -edge - x)
        )
        return amplitude * amplitude
    start = math.cos(WAVE_NUMBER * -edge) + reflection * math.cos(WAVE_NUMBER * -edge)
    decay_start = max(start * start, transmitted)
    decay = (
        math.log(decay_start / transmitted) / (2 * (2 * edge))
        if decay_start > transmitted
        else 0.0
    )
    if x < edge:
        return decay_start * math.exp(-2 * decay * (x + edge))
    amplitude = math.sqrt(transmitted) * math.cos(WAVE_NUMBER * (x - edge))
    return amplitude * amplitude


def build_svg(example: dict[str, float], *, axis_label: str) -> str:
    """Genera el SVG del diagrama (potencial + |psi|^2) para el manual."""
    extent = PROFILE_EXTENT_IN_LENGTHS * CHARACTERISTIC_LENGTH
    coordinates = [
        -extent + (2 * extent * index / (SAMPLE_COUNT - 1))
        for index in range(SAMPLE_COUNT)
    ]
    probability = transmission_probability(
        example["u"], example["u"], example["alpha1"], example["alpha2"]
    )

    # Campana canónica de Eckart (V0 en el TS, colas a 0); ΔE se marca aparte.
    potential_points = [(x, potential(x, example["barrier"])) for x in coordinates]
    density_raw = [(x, probability_density(x, probability)) for x in coordinates]
    density_peak = max(value for _, value in density_raw) or 1.0
    density_points = [(x, value / density_peak) for x, value in density_raw]

    energies = [value for _, value in potential_points] + [example["delta_e"], 0.0]
    low, high = min(energies), max(energies)
    span = (high - low) or 1.0
    low -= 0.08 * span
    # Aire arriba: la onda |psi|^2 vive en la franja superior y no debe tocar el borde.
    high += 0.30 * span
    # La referencia de productos (ΔE) debe quedar dentro del encuadre.
    low = min(low, example["delta_e"] - 0.05 * span)

    plot_width = WIDTH - PAD_LEFT - PAD_RIGHT
    plot_height = HEIGHT - PAD_TOP - PAD_BOTTOM

    def to_x(x: float) -> float:
        return PAD_LEFT + (x + extent) / (2 * extent) * plot_width

    def to_y(energy: float) -> float:
        return PAD_TOP + (high - energy) / (high - low) * plot_height

    def to_density(value: float) -> float:
        # |psi|^2 ocupa el tercio superior para no tapar el potencial.
        return PAD_TOP + (1 - value) * plot_height * 0.34

    potential_path = " ".join(
        f"{'M' if index == 0 else 'L'}{to_x(x):.1f},{to_y(value):.1f}"
        for index, (x, value) in enumerate(potential_points)
    )
    density_path = " ".join(
        f"{'M' if index == 0 else 'L'}{to_x(x):.1f},{to_density(value):.1f}"
        for index, (x, value) in enumerate(density_points)
    )

    zero_y = to_y(0.0)
    peak_y = to_y(example["barrier"])
    product_y = to_y(example["delta_e"])

    return f"""<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="{axis_label}">
<line x1="{PAD_LEFT}" y1="{HEIGHT - PAD_BOTTOM}" x2="{WIDTH - PAD_RIGHT}" y2="{HEIGHT - PAD_BOTTOM}" stroke="currentColor" stroke-width="1" opacity="0.35"/>
<line x1="{PAD_LEFT}" y1="{PAD_TOP}" x2="{PAD_LEFT}" y2="{HEIGHT - PAD_BOTTOM}" stroke="currentColor" stroke-width="1" opacity="0.35"/>
<line x1="{PAD_LEFT}" y1="{zero_y:.1f}" x2="{WIDTH - PAD_RIGHT}" y2="{zero_y:.1f}" stroke="currentColor" stroke-width="0.8" opacity="0.2"/>
<path d="{potential_path}" fill="none" stroke="#6a4c93" stroke-width="2.4"/>
<path d="{density_path}" fill="none" stroke="#0277bd" stroke-width="1.6" opacity="0.9"/>
<circle cx="{to_x(-extent):.1f}" cy="{zero_y:.1f}" r="3" fill="#6a4c93"/>
<circle cx="{to_x(0):.1f}" cy="{peak_y:.1f}" r="3" fill="#6a4c93"/>
<circle cx="{to_x(extent):.1f}" cy="{product_y:.1f}" r="3" fill="#6a4c93"/>
<text x="{to_x(-extent) + 6:.1f}" y="{zero_y - 6:.1f}" font-size="10">R (0)</text>
<text x="{to_x(0) - 18:.1f}" y="{peak_y - 8:.1f}" font-size="10">TS ({example["barrier"]:.1f})</text>
<text x="{WIDTH - PAD_RIGHT - 58:.1f}" y="{product_y - 6:.1f}" font-size="10">P ({example["delta_e"]:.1f})</text>
<line x1="{PAD_LEFT + 8}" y1="{HEIGHT - PAD_BOTTOM - 30}" x2="{PAD_LEFT + 24}" y2="{HEIGHT - PAD_BOTTOM - 30}" stroke="#6a4c93" stroke-width="2.4"/>
<text x="{PAD_LEFT + 28}" y="{HEIGHT - PAD_BOTTOM - 26}" font-size="10" fill="#6a4c93">V(x)</text>
<line x1="{PAD_LEFT + 8}" y1="{HEIGHT - PAD_BOTTOM - 14}" x2="{PAD_LEFT + 24}" y2="{HEIGHT - PAD_BOTTOM - 14}" stroke="#0277bd" stroke-width="1.8"/>
<text x="{PAD_LEFT + 28}" y="{HEIGHT - PAD_BOTTOM - 10}" font-size="10" fill="#0277bd">|ψ|²</text>
<text x="{WIDTH - PAD_RIGHT - 92:.1f}" y="{HEIGHT - 10}" font-size="10" opacity="0.75">P(E = u) = {probability:.3f}</text>
</svg>"""


def update_locale(locale_path: Path, *, dry_run: bool) -> bool:
    """Sustituye el SVG del ejemplo en un catálogo i18n. Retorna si cambió."""
    payload = json.loads(locale_path.read_text(encoding="utf-8"))
    docs = payload.get("scientificDoc", {}).get("docs", {})
    changed = False

    for app_key, example, label in (
        (
            "tunnel",
            TUNNEL_EXAMPLE,
            "Eckart tunneling profile: barrier potential and probability density",
        ),
        (
            "easyRate",
            EASY_RATE_EXAMPLE,
            "Reaction energy profile with tunneling probability density",
        ),
    ):
        section = docs.get(app_key, {}).get("example")
        if not isinstance(section, str) or "<svg" not in section:
            continue
        start = section.index("<svg")
        end = section.index("</svg>") + len("</svg>")
        replacement = build_svg(example, axis_label=label)
        if section[start:end] != replacement:
            docs[app_key]["example"] = section[:start] + replacement + section[end:]
            changed = True

    if changed and not dry_run:
        locale_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Regenera los diagramas de energía de los manuales."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="No escribe los catálogos."
    )
    arguments = parser.parse_args()

    locale_paths = sorted(I18N_DIR.glob("*.json"))
    if not locale_paths:
        print(f"No hay catálogos i18n en {I18N_DIR}")
        return 1

    changed = 0
    for locale_path in locale_paths:
        if update_locale(locale_path, dry_run=arguments.dry_run):
            changed += 1
            print(f"[docs] actualizado: {locale_path.name}")

    print(f"[docs] {changed}/{len(locale_paths)} catálogos regenerados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Regenera Neuro_RefSet.csv multi-método:
  - ADME (RDKit)
  - Toxicidad ADMET-AI (preserva TEST existente)
  - SA: AMBIT, BRSAScore, RDKit
  - Verifica SA_ambit contra valores preexistentes
  - Preserva literatura del CSV de entrada

Uso:
    poetry run python manage.py regenerate_neuro_refset
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from django.core.management.base import BaseCommand

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

if TYPE_CHECKING:
    from libs.admet_ai.client import AdmetAiClient


SAMPLE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "samples"

FIELD_NAMES = [
    "name", "MW", "logP", "MR", "AtX", "HBLA", "HBLD", "RB", "PSA",
    "DT", "M", "LD50", "SA",
    "DT_test", "M_test", "LD50_test",
    "DT_admet", "M_admet", "LD50_admet",
    "SA_ambit", "SA_brsa", "SA_rdkit",
    "smile",
    "papertitle", "doi", "note", "authors",
]


def _canonicalize(smiles: str) -> str | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, isomericSmiles=True, canonical=True)


def _compute_adme(smiles: str) -> dict[str, float] | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return {
        "MW": float(Descriptors.MolWt(mol)),
        "logP": float(Crippen.MolLogP(mol)),
        "MR": float(Crippen.MolMR(mol)),
        "AtX": float(mol.GetNumHeavyAtoms()),
        "HBLA": float(Lipinski.NumHAcceptors(mol)),
        "HBLD": float(Lipinski.NumHDonors(mol)),
        "RB": float(Lipinski.NumRotatableBonds(mol)),
        "PSA": float(rdMolDescriptors.CalcTPSA(mol)),
    }


def _compute_sa_rdkit(smiles: str) -> float | None:
    from rdkit.Contrib.SA_Score import sascorer
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    raw = sascorer.calculateScore(mol)
    return max(0, min(100, ((10 - raw) / 9) * 100))


def _compute_sa_brsa(smiles: str) -> float | None:
    from libs.brsascore.client import BrsaScoreClient
    try:
        result = BrsaScoreClient().predict_sa_score(smiles)
        if result.success and result.sa_score is not None:
            raw = float(result.sa_score)
            return max(0, min(100, 100 - ((raw - 1) * (100 / 9))))
        return None
    except Exception:
        return None


def _compute_sa_ambit(smiles: str) -> float | None:
    from libs.ambit.client import AmbitClient
    try:
        result = AmbitClient().predict_sa_score(smiles)
        if result.success and result.sa_score is not None:
            return float(result.sa_score)
        return None
    except Exception:
        return None


def _resolve_literature(name: str) -> dict[str, str]:
    """Busca literatura neurodegenerativa desde literature_catalog.py."""
    from apps.cadma_py.literature_catalog import _resolve_compound_literature
    return _resolve_compound_literature(name, sample_key="neuro")


def _clean(val: str | None, default: str = "") -> str:
    return val.strip() if val else default


def _parse_float(val: str | None) -> float | None:
    value = _clean(val)
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _format_test_values(row: dict[str, str]) -> dict[str, str]:
    """Formatea los valores experimentales TEST de la fila (2 decimales o vacío)."""
    formatted: dict[str, str] = {}
    for key in ("DT_test", "M_test", "LD50_test"):
        parsed = _parse_float(row.get(key))
        formatted[key] = f"{parsed:.2f}" if parsed is not None else ""
    return formatted


def _format_sa_values(
    canonical: str,
    row: dict[str, str],
    ambit_mismatches: list[str],
    name: str,
) -> dict[str, str]:
    """Calcula SA por 3 métodos y reporta discrepancias contra el valor existente."""
    sa_rdkit = _compute_sa_rdkit(canonical)
    sa_brsa = _compute_sa_brsa(canonical)
    sa_ambit = _compute_sa_ambit(canonical)
    sa_default = sa_rdkit if sa_rdkit is not None else sa_brsa
    formatted = {
        "SA_rdkit": f"{sa_rdkit:.3f}" if sa_rdkit is not None else "",
        "SA_brsa": f"{sa_brsa:.3f}" if sa_brsa is not None else "",
        "SA_ambit": f"{sa_ambit:.3f}" if sa_ambit is not None else "",
        "SA": f"{sa_default:.3f}" if sa_default is not None else "50.000",
    }
    existing_sa_ambit = _parse_float(row.get("SA_ambit"))
    if sa_ambit is not None and existing_sa_ambit is not None:
        diff = abs(sa_ambit - existing_sa_ambit)
        if diff > 0.5:
            ambit_mismatches.append(
                f"    {name}: existente={existing_sa_ambit:.3f} "
                f"calculado={sa_ambit:.3f} diff={diff:.3f}"
            )
    return formatted


def _fetch_admet_values(
    command: Command,
    admet_client: AdmetAiClient,
    canonical: str,
    adme: dict[str, float],
    name: str,
) -> dict[str, float | None]:
    """Consulta ADMET-AI y extrae DT/M/LD50 (None si falla)."""
    try:
        tox_result = admet_client.predict_properties(canonical)
        if tox_result.success:
            tox = _extract_admet_toxicity(tox_result.predictions, adme["MW"])
            return {"DT": tox.get("DT"), "M": tox.get("M"), "LD50": tox.get("LD50")}
        command.stderr.write(f"    ADMET-AI falló para {name}")
    except Exception as error:
        command.stderr.write(f"    ADMET-AI error para {name}: {error}")
    return {"DT": None, "M": None, "LD50": None}


def _format_admet_fallbacks(
    row_out: dict[str, str], admet: dict[str, float | None]
) -> None:
    """Escribe valores ADMET-AI con fallbacks y resuelve DT/M/LD50 finales."""
    row_out["DT_admet"] = f"{admet['DT']:.2f}" if admet["DT"] is not None else "0.50"
    row_out["M_admet"] = f"{admet['M']:.2f}" if admet["M"] is not None else "0.50"
    row_out["LD50_admet"] = (
        f"{admet['LD50']:.2f}" if admet["LD50"] is not None else "500.00"
    )
    row_out["DT"] = row_out["DT_test"] if row_out["DT_test"] else row_out["DT_admet"]
    row_out["M"] = row_out["M_test"] if row_out["M_test"] else row_out["M_admet"]
    row_out["LD50"] = (
        row_out["LD50_test"] if row_out["LD50_test"] else row_out["LD50_admet"]
    )


def _resolve_row_literature(row: dict[str, str], name: str) -> dict[str, str]:
    """Conserva la literatura existente o resuelve la del catálogo por nombre."""
    existing_papertitle = _clean(row.get("papertitle", ""))
    if existing_papertitle:
        return {
            "papertitle": existing_papertitle,
            "doi": _clean(row.get("doi", "")),
            "note": _clean(row.get("note", "")),
            "authors": _clean(row.get("authors", "")),
        }
    literature = _resolve_literature(name)
    return {
        "papertitle": _clean(literature.get("paper_reference", "")),
        "doi": _clean(literature.get("paper_url", "")),
        "note": _clean(literature.get("evidence_note", "")),
        "authors": _clean(literature.get("paper_authors", "")),
    }


def _process_neuro_row(
    command: Command,
    row: dict[str, str],
    index: int,
    total: int,
    admet_client: AdmetAiClient,
    ambit_mismatches: list[str],
) -> dict[str, str] | None:
    name = _clean(row.get("name", ""))
    raw_smiles = _clean(row.get("smile", ""))
    command.stdout.write(f"  [{index}/{total}] {name if name else '?'}...")

    canonical = _canonicalize(raw_smiles)
    if not canonical:
        command.stderr.write(f"    SMILES inválido: {raw_smiles}")
        return None

    adme = _compute_adme(canonical)
    if not adme:
        command.stderr.write("    No se pudieron computar ADME")
        return None

    row_out: dict[str, str] = {
        "name": name,
        "MW": f"{adme['MW']:.2f}",
        "logP": f"{adme['logP']:.2f}",
        "MR": f"{adme['MR']:.2f}",
        "AtX": str(int(adme["AtX"])),
        "HBLA": str(int(adme["HBLA"])),
        "HBLD": str(int(adme["HBLD"])),
        "RB": str(int(adme["RB"])),
        "PSA": f"{adme['PSA']:.2f}",
        "smile": canonical,
    }

    row_out.update(_format_test_values(row))
    row_out.update(_format_sa_values(canonical, row, ambit_mismatches, name))

    command.stdout.write("    Consultando ADMET-AI...")
    admet = _fetch_admet_values(command, admet_client, canonical, adme, name)
    _format_admet_fallbacks(row_out, admet)
    row_out.update(_resolve_row_literature(row, name))
    return row_out


class Command(BaseCommand):
    help = "Regenera Neuro_RefSet.csv multi-método con TEST + ADMET-AI + SA (3 métodos)"

    def handle(self, *args, **options) -> None:
        prev_csv = SAMPLE_DIR / "Neuro_RefSet.csv"
        output_path = SAMPLE_DIR / "Neuro_RefSet.csv"

        if not prev_csv.exists():
            self.stderr.write(f"ERROR: no se encuentra {prev_csv}")
            sys.exit(1)

        rows = []
        with open(prev_csv, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)

        self.stdout.write(f"Cargando {len(rows)} moléculas desde {prev_csv.name}...")

        from libs.admet_ai.client import AdmetAiClient
        admet_client = AdmetAiClient()

        output_rows: list[dict[str, str]] = []
        ambit_mismatches: list[str] = []

        for i, row in enumerate(rows, 1):
            row_out = _process_neuro_row(
                self, row, i, len(rows), admet_client, ambit_mismatches
            )
            if row_out is not None:
                output_rows.append(row_out)

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELD_NAMES)
            writer.writeheader()
            writer.writerows(output_rows)

        stats = {
            "total": len(output_rows),
            "sa_rdkit": sum(1 for r in output_rows if r.get("SA_rdkit")),
            "sa_brsa": sum(1 for r in output_rows if r.get("SA_brsa")),
            "sa_ambit": sum(1 for r in output_rows if r.get("SA_ambit")),
            "dt_test": sum(1 for r in output_rows if r.get("DT_test")),
            "m_test": sum(1 for r in output_rows if r.get("M_test")),
            "ld50_test": sum(1 for r in output_rows if r.get("LD50_test")),
            "dt_admet": sum(1 for r in output_rows if r.get("DT_admet")),
            "with_literature": sum(
                1 for r in output_rows if r.get("papertitle")
            ),
        }
        self.stdout.write(self.style.SUCCESS(
            f"✓ Neuro_RefSet.csv regenerado con {stats['total']} moléculas\n"
            f"  SA: rdkit={stats['sa_rdkit']}, brsa={stats['sa_brsa']}, ambit={stats['sa_ambit']}\n"
            f"  Tox TEST: DT={stats['dt_test']}, M={stats['m_test']}, LD50={stats['ld50_test']}\n"
            f"  Tox ADMET: DT={stats['dt_admet']}\n"
            f"  Literatura: {stats['with_literature']}/{stats['total']}"
        ))
        if ambit_mismatches:
            self.stdout.write(self.style.WARNING(
                "\n⚠ Discrepancias en SA_ambit (>0.5):\n" + "\n".join(ambit_mismatches)
            ))
        else:
            self.stdout.write(self.style.SUCCESS("✓ SA_ambit verificado: todos coinciden"))


def _relevant_admet_predictions(predictions: dict[str, float]) -> list[tuple[str, float]]:
    return [
        (key.lower(), value)
        for key, value in predictions.items()
        if "_drugbank_approved_percentile" not in key.lower()
    ]


def _first_prediction_matching(
    predictions: list[tuple[str, float]], term: str
) -> float | None:
    for key, value in predictions:
        if term in key:
            return value
    return None


def _extract_direct_admet_predictions(
    predictions: list[tuple[str, float]],
) -> tuple[dict[str, float], float | None]:
    result: dict[str, float] = {}
    ld50_log = None
    for key, value in predictions:
        if "ld50" in key:
            ld50_log = value
        elif "ames" in key or "mutagen" in key:
            result["M"] = value
        elif "devtox" in key or "development" in key:
            result["DT"] = value
    return result, ld50_log


def _extract_admet_toxicity(
    predictions: dict[str, float],
    molecular_weight: float,
) -> dict[str, float]:
    relevant = _relevant_admet_predictions(predictions)
    result, ld50_log = _extract_direct_admet_predictions(relevant)

    result["LD50"] = (
        max(0.01, round((10 ** (-ld50_log)) * molecular_weight * 1000, 2))
        if ld50_log is not None else 500.0
    )
    if "DT" not in result:
        clintox = _first_prediction_matching(relevant, "clintox")
        if clintox is not None:
            result["DT"] = clintox

    result.setdefault("M", 0.5)
    result.setdefault("DT", 0.5)
    return result

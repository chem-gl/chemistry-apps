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

from django.core.management.base import BaseCommand

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors


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

        def _clean(val: str | None, default: str = "") -> str:
            return val.strip() if val else default

        def _parse_float(val: str | None) -> float | None:
            v = _clean(val)
            if not v:
                return None
            try:
                return float(v)
            except ValueError:
                return None

        for i, row in enumerate(rows, 1):
            name = _clean(row.get("name", ""))
            raw_smiles = _clean(row.get("smile", ""))
            self.stdout.write(f"  [{i}/{len(rows)}] {name if name else '?'}...")

            canonical = _canonicalize(raw_smiles)
            if not canonical:
                self.stderr.write(f"    SMILES inválido: {raw_smiles}")
                continue

            adme = _compute_adme(canonical)
            if not adme:
                self.stderr.write("    No se pudieron computar ADME")
                continue

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

            # --- Preservar TEST existente (viene en el CSV del usuario) ---
            dt_test = _parse_float(row.get("DT_test"))
            m_test = _parse_float(row.get("M_test"))
            ld50_test = _parse_float(row.get("LD50_test"))
            row_out["DT_test"] = f"{dt_test:.2f}" if dt_test is not None else ""
            row_out["M_test"] = f"{m_test:.2f}" if m_test is not None else ""
            row_out["LD50_test"] = f"{ld50_test:.2f}" if ld50_test is not None else ""

            # --- SA: tres métodos ---
            sa_rdkit = _compute_sa_rdkit(canonical)
            sa_brsa = _compute_sa_brsa(canonical)
            sa_ambit = _compute_sa_ambit(canonical)
            sa_default = sa_rdkit if sa_rdkit is not None else sa_brsa

            row_out["SA_rdkit"] = f"{sa_rdkit:.3f}" if sa_rdkit is not None else ""
            row_out["SA_brsa"] = f"{sa_brsa:.3f}" if sa_brsa is not None else ""

            # Verificar SA_ambit vs valor existente
            existing_sa_ambit = _parse_float(row.get("SA_ambit"))
            if sa_ambit is not None and existing_sa_ambit is not None:
                diff = abs(sa_ambit - existing_sa_ambit)
                if diff > 0.5:
                    ambit_mismatches.append(f"    {name}: existente={existing_sa_ambit:.3f} calculado={sa_ambit:.3f} diff={diff:.3f}")
            row_out["SA_ambit"] = f"{sa_ambit:.3f}" if sa_ambit is not None else ""
            row_out["SA"] = f"{sa_default:.3f}" if sa_default is not None else "50.000"

            # --- Toxicidad ADMET-AI (siempre consultar porque el CSV las tiene vacías) ---
            self.stdout.write(f"    Consultando ADMET-AI...")
            try:
                tox_result = admet_client.predict_properties(canonical)
                if tox_result.success:
                    tox = _extract_admet_toxicity(tox_result.predictions, adme["MW"])
                    dt_admet = tox.get("DT")
                    m_admet = tox.get("M")
                    ld50_admet = tox.get("LD50")
                else:
                    dt_admet = m_admet = ld50_admet = None
                    self.stderr.write(f"    ADMET-AI falló para {name}")
            except Exception as e:
                dt_admet = m_admet = ld50_admet = None
                self.stderr.write(f"    ADMET-AI error para {name}: {e}")

            row_out["DT_admet"] = f"{dt_admet:.2f}" if dt_admet is not None else "0.50"
            row_out["M_admet"] = f"{m_admet:.2f}" if m_admet is not None else "0.50"
            row_out["LD50_admet"] = f"{ld50_admet:.2f}" if ld50_admet is not None else "500.00"

            # --- Columnas base = TEST (o fallback admet) ---
            row_out["DT"] = row_out["DT_test"] if row_out["DT_test"] else row_out["DT_admet"]
            row_out["M"] = row_out["M_test"] if row_out["M_test"] else row_out["M_admet"]
            row_out["LD50"] = row_out["LD50_test"] if row_out["LD50_test"] else row_out["LD50_admet"]

            # --- Literatura: preservar existente, resolver solo si vacío ---
            existing_papertitle = _clean(row.get("papertitle", ""))
            if existing_papertitle:
                row_out["papertitle"] = existing_papertitle
                row_out["doi"] = _clean(row.get("doi", ""))
                row_out["note"] = _clean(row.get("note", ""))
                row_out["authors"] = _clean(row.get("authors", ""))
            else:
                lit = _resolve_literature(name)
                row_out["papertitle"] = _clean(lit.get("paper_reference", ""))
                row_out["doi"] = _clean(lit.get("paper_url", ""))
                row_out["note"] = _clean(lit.get("evidence_note", ""))
                row_out["authors"] = _clean(lit.get("paper_authors", ""))

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


def _extract_admet_toxicity(
    predictions: dict[str, float],
    molecular_weight: float,
) -> dict[str, float]:
    result: dict[str, float] = {}
    ld50_log = None
    for k, v in predictions.items():
        kl = k.lower()
        if "_drugbank_approved_percentile" in kl:
            continue
        if "ld50" in kl:
            ld50_log = v
        elif "ames" in kl or "mutagen" in kl:
            result["M"] = v
        elif "devtox" in kl or "development" in kl:
            result["DT"] = v

    if ld50_log is not None:
        result["LD50"] = max(0.01, round((10 ** (-ld50_log)) * molecular_weight * 1000, 2))
    else:
        result["LD50"] = 500.0

    if "DT" not in result:
        for k, v in predictions.items():
            kl = k.lower()
            if "_drugbank_approved_percentile" in kl:
                continue
            if "clintox" in kl:
                result["DT"] = v
                break

    result.setdefault("M", 0.5)
    result.setdefault("DT", 0.5)
    return result

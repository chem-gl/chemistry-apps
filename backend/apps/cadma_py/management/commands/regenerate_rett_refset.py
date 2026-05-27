"""Regenera RETT_RefSet.csv multi-método con:
  - ADME (RDKit)
  - Toxicidad TEST + ADMET-AI
  - SA: AMBIT (Java), BRSAScore, RDKit

Columnas: name, MW, ..., smile, DT, M, LD50, SA,
          DT_test, M_test, LD50_test,
          DT_admet, M_admet, LD50_admet,
          SA_ambit, SA_brsa, SA_rdkit

Uso:
    poetry run python manage.py regenerate_rett_refset
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
    except Exception as exc:
        return None


def _compute_sa_ambit(smiles: str) -> float | None:
    from libs.ambit.client import AmbitClient
    try:
        result = AmbitClient().predict_sa_score(smiles)
        if result.success and result.sa_score is not None:
            return float(result.sa_score)
        return None
    except Exception as exc:
        return None


def _load_csv(path: Path) -> dict[str, dict[str, str]]:
    """Carga CSV indexado por SMILES canónico."""
    index: dict[str, dict[str, str]] = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_smile = row.get("smile", row.get("SMILES", "")).strip()
            can = _canonicalize(raw_smile)
            if can:
                if can in index:
                    continue
                index[can] = dict(row)
    return index


class Command(BaseCommand):
    help = "Regenera RETT_RefSet.csv multi-método con TEST + ADMET-AI + SA (3 métodos)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--test-csv",
            default=str(SAMPLE_DIR / "RETT_RefSet_test.csv"),
            help="CSV con toxicidades de TEST (EPA)",
        )

    def handle(self, *args, **options) -> None:
        test_csv_path = Path(options["test_csv"])
        prev_csv = SAMPLE_DIR / "RETT_RefSet.csv"
        output_path = SAMPLE_DIR / "RETT_RefSet.csv"

        if not prev_csv.exists():
            self.stderr.write(f"ERROR: no se encuentra {prev_csv}")
            sys.exit(1)

        rows = []
        with open(prev_csv, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)

        self.stdout.write(f"Cargando {len(rows)} moléculas desde {prev_csv.name}...")

        # Cargar TEST CSV si existe
        test_data: dict[str, dict[str, str]] = {}
        if test_csv_path.exists():
            test_data = _load_csv(test_csv_path)
            self.stdout.write(f"  {len(test_data)} compuestos cargados desde TEST CSV")
        else:
            self.stderr.write(f"  AVISO: no se encuentra {test_csv_path}")

        # Cargar ADMET-AI existente (previo)
        admet_data: dict[str, dict[str, str]] = {}
        prev_csv = SAMPLE_DIR / "RETT_RefSet.csv"
        if prev_csv.exists():
            admet_data = _load_csv(prev_csv)
            self.stdout.write(f"  {len(admet_data)} compuestos cargados desde ADMET-AI previo")

        from libs.admet_ai.client import AdmetAiClient
        admet_client = AdmetAiClient()

        output_rows: list[dict[str, str]] = []

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

            # --- ADME base (siempre de RDKit) ---
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

            # --- SA: tres métodos ---
            sa_rdkit = _compute_sa_rdkit(canonical)
            sa_brsa = _compute_sa_brsa(canonical)
            sa_ambit = _compute_sa_ambit(canonical)
            sa_default = sa_rdkit if sa_rdkit is not None else sa_brsa

            row_out["SA_rdkit"] = f"{sa_rdkit:.3f}" if sa_rdkit is not None else ""
            row_out["SA_brsa"] = f"{sa_brsa:.3f}" if sa_brsa is not None else ""
            row_out["SA_ambit"] = f"{sa_ambit:.3f}" if sa_ambit is not None else ""
            row_out["SA"] = f"{sa_default:.3f}" if sa_default is not None else "50.000"

            # --- Toxicidad TEST ---
            test_row = test_data.get(canonical, {})
            dt_test = _parse_float(test_row.get("DT"))
            m_test = _parse_float(test_row.get("M"))
            ld50_test = _parse_float(test_row.get("LD50"))

            row_out["DT_test"] = f"{dt_test:.2f}" if dt_test is not None else ""
            row_out["M_test"] = f"{m_test:.2f}" if m_test is not None else ""
            row_out["LD50_test"] = f"{ld50_test:.2f}" if ld50_test is not None else ""

            # --- Toxicidad ADMET-AI ---
            admet_row = admet_data.get(canonical, {})
            dt_admet = _parse_float(admet_row.get("DT"))
            m_admet = _parse_float(admet_row.get("M"))
            ld50_admet = _parse_float(admet_row.get("LD50"))

            if dt_admet is None or m_admet is None or ld50_admet is None:
                self.stdout.write(f"    Consultando ADMET-AI (nuevo)...")
                tox_result = admet_client.predict_properties(canonical)
                if tox_result.success:
                    tox = _extract_admet_toxicity(tox_result.predictions, adme["MW"])
                    dt_admet = dt_admet if dt_admet is not None else tox.get("DT")
                    m_admet = m_admet if m_admet is not None else tox.get("M")
                    ld50_admet = ld50_admet if ld50_admet is not None else tox.get("LD50")

            row_out["DT_admet"] = f"{dt_admet:.2f}" if dt_admet is not None else "0.50"
            row_out["M_admet"] = f"{m_admet:.2f}" if m_admet is not None else "0.50"
            row_out["LD50_admet"] = f"{ld50_admet:.2f}" if ld50_admet is not None else "500.00"

            # --- Columnas base = TEST (o fallback admet) ---
            row_out["DT"] = row_out["DT_test"] if row_out["DT_test"] else row_out["DT_admet"]
            row_out["M"] = row_out["M_test"] if row_out["M_test"] else row_out["M_admet"]
            row_out["LD50"] = row_out["LD50_test"] if row_out["LD50_test"] else row_out["LD50_admet"]

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
        }
        self.stdout.write(self.style.SUCCESS(
            f"✓ RETT_RefSet.csv regenerado con {stats['total']} moléculas\n"
            f"  SA: rdkit={stats['sa_rdkit']}, brsa={stats['sa_brsa']}, ambit={stats['sa_ambit']}\n"
            f"  Tox TEST: DT={stats['dt_test']}, M={stats['m_test']}, LD50={stats['ld50_test']}\n"
            f"  Tox ADMET: DT={stats['dt_admet']}"
        ))


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

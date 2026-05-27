"""Compara valores ADME computados por RDKit vs los del archivo de referencia TEST."""
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

TEST_CSV = Path(__file__).resolve().parent.parent.parent / "data" / "samples" / "RETT_RefSet_test.csv"

def compute_adme(smiles: str) -> dict:
    mol = Chem.MolFromSmiles(smiles)
    if not mol:
        return {}
    return {
        "MW": round(Descriptors.MolWt(mol), 3),
        "logP": round(Crippen.MolLogP(mol), 4),
        "MR": round(Crippen.MolMR(mol), 4),
        "AtX": mol.GetNumHeavyAtoms(),
        "HBLA": Lipinski.NumHAcceptors(mol),
        "HBLD": Lipinski.NumHDonors(mol),
        "RB": Lipinski.NumRotatableBonds(mol),
        "PSA": round(rdMolDescriptors.CalcTPSA(mol), 2),
    }

import csv

with open(TEST_CSV, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    mismatches = []
    ok_count = 0
    for row in reader:
        name = row["Compound"]
        ref_smile = row["smile"]
        # Usar SMILES raw (sin re-canonicalizar) para evitar diferencias de tautómeros
        my = compute_adme(ref_smile)
        diffs = []
        for col in ["MW", "logP", "MR", "AtX", "HBLA", "HBLD", "RB", "PSA"]:
            ref_val = float(row[col]) if row[col] else None
            my_val = float(my[col]) if col in my else None
            if ref_val is not None and my_val is not None:
                diff = abs(ref_val - my_val)
                if col in ("AtX", "HBLA", "HBLD", "RB") and diff > 0:
                    diffs.append(f"{col}: ref={ref_val} my={my_val}")
                elif col in ("MW",) and diff > 0.05:
                    diffs.append(f"{col}: ref={ref_val} my={my_val}")
                elif col in ("logP", "MR") and diff > 0.01:
                    diffs.append(f"{col}: ref={ref_val} my={my_val}")
                elif col == "PSA" and diff > 0.1:
                    diffs.append(f"{col}: ref={ref_val} my={my_val}")
        if diffs:
            mismatches.append((name, diffs))
        else:
            ok_count += 1

    print(f"✓ Coinciden sin diferencias: {ok_count}")
    if mismatches:
        print(f"\n✗ Diferencias detectadas ({len(mismatches)}):")
        for name, diffs in mismatches:
            print(f"  {name}:")
            for d in diffs:
                print(f"    {d}")
    else:
        print("✓ Todas las moléculas coinciden.")

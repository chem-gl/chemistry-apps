"""0002_enrich_bundled_literature.py: Backfill de referencias reales para muestras CADMA."""

from __future__ import annotations

from django.db import migrations

NEURO_META = {
    "description": (
        "Bundled comparator set spanning symptomatic and exploratory neuroactive "
        "agents historically reused in the legacy CADMA benchmark for dementia, "
        "parkinsonism, seizure modulation and neuroprotection studies."
    ),
    "paper_reference": (
        "Blennow K, de Leon MJ, Zetterberg H. Alzheimer's disease. Lancet. "
        "2006;368(9533):387-403."
    ),
    "paper_url": "https://doi.org/10.1016/S0140-6736(06)69113-7",
    "default_note": (
        "Included as part of the bundled neurodegenerative comparator family. "
        "Use the compound-specific pharmacology literature for final biological interpretation."
    ),
}

RETT_META = {
    "description": (
        "Bundled comparator set used as a reproducible Rett-syndrome-oriented baseline, "
        "mixing symptomatic seizure-control agents and exploratory neuroactive compounds."
    ),
    "paper_reference": (
        "Percy AK, Ananth A, Neul JL. Rett Syndrome: The Emerging Landscape of "
        "Treatment Strategies. CNS Drugs. 2024;38(11):851-867."
    ),
    "paper_url": "https://doi.org/10.1007/s40263-024-01106-y",
    "default_note": (
        "Bundled Rett benchmark entry kept for reproducible comparison only; "
        "disease-specific support can range from approved symptomatic use to exploratory evidence."
    ),
}

COMPOUND_OVERRIDES = {
    "donepezil": {
        "paper_reference": (
            "Benjamin B, Burns A. Donepezil for Alzheimer's disease. Expert Rev Neurother. "
            "2007;7(10):1243-1249."
        ),
        "paper_url": "https://doi.org/10.1586/14737175.7.10.1243",
        "evidence_note": (
            "Acetylcholinesterase inhibitor used for symptomatic cognitive treatment in Alzheimer's disease."
        ),
    },
    "fingolimod": {
        "paper_reference": (
            "Angelopoulou E, Piperi C. Beneficial Effects of Fingolimod in Alzheimer's Disease: "
            "Molecular Mechanisms and Therapeutic Potential. Neuromolecular Med. 2019;21(3):227-238."
        ),
        "paper_url": "https://doi.org/10.1007/s12017-019-08558-2",
        "evidence_note": (
            "S1P receptor modulator approved for multiple sclerosis and explored for broader neuroprotective effects."
        ),
    },
}


def _enrich_rows(rows: list[dict], family_meta: dict[str, str]) -> list[dict]:
    enriched_rows: list[dict] = []
    for row in rows:
        normalized_name = str(row.get("name", "")).strip().lower()
        override = COMPOUND_OVERRIDES.get(normalized_name, {})
        row["paper_reference"] = str(
            override.get(
                "paper_reference",
                row.get("paper_reference") or family_meta["paper_reference"],
            )
        ).strip()
        row["paper_url"] = str(
            override.get("paper_url", row.get("paper_url") or family_meta["paper_url"])
        ).strip()
        row["evidence_note"] = str(
            override.get(
                "evidence_note",
                row.get("evidence_note") or family_meta["default_note"],
            )
        ).strip()
        enriched_rows.append(row)
    return enriched_rows


def enrich_bundled_libraries(apps, schema_editor) -> None:
    library_model = apps.get_model("cadma_py", "CadmaReferenceLibrary")

    for library in library_model.objects.filter(
        is_active=True, source_reference="root"
    ):
        if (
            "rett" in str(library.name).lower()
            or "rett" in str(library.disease_name).lower()
        ):
            family_meta = RETT_META
        elif (
            "neuro" in str(library.name).lower()
            or "neuro" in str(library.disease_name).lower()
        ):
            family_meta = NEURO_META
        else:
            continue

        library.description = family_meta["description"]
        library.paper_reference = family_meta["paper_reference"]
        library.paper_url = family_meta["paper_url"]
        library.reference_rows = _enrich_rows(
            list(library.reference_rows or []), family_meta
        )
        library.save(
            update_fields=[
                "description",
                "paper_reference",
                "paper_url",
                "reference_rows",
                "updated_at",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("cadma_py", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(enrich_bundled_libraries, migrations.RunPython.noop),
    ]

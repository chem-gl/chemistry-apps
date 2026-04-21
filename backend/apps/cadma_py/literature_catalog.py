"""literature_catalog.py: Referencias reales y notas curatoriales para muestras CADMA.

Objetivo del archivo:
- Centralizar citas verificables para las familias bundled de CADMA Py.
- Evitar placeholders genéricos cuando se importan las muestras legacy.
- Enriquecer las filas con notas honestas y trazables sin inventar evidencia.
"""

from __future__ import annotations

from typing import Final, TypedDict

from .types import CadmaCompoundRow


class SampleLiteratureMetadata(TypedDict):
    """Metadatos curatoriales de alto nivel para una familia bundled."""

    description: str
    paper_reference: str
    paper_url: str
    default_evidence_note: str


SAMPLE_LITERATURE: Final[dict[str, SampleLiteratureMetadata]] = {
    "neuro": {
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
        "default_evidence_note": (
            "Included as part of the bundled neurodegenerative comparator family. "
            "Use the compound-specific pharmacology literature for final biological interpretation."
        ),
    },
    "rett": {
        "description": (
            "Bundled comparator set used as a reproducible Rett-syndrome-oriented baseline, "
            "mixing symptomatic seizure-control agents and exploratory neuroactive compounds."
        ),
        "paper_reference": (
            "Percy AK, Ananth A, Neul JL. Rett Syndrome: The Emerging Landscape of "
            "Treatment Strategies. CNS Drugs. 2024;38(11):851-867."
        ),
        "paper_url": "https://doi.org/10.1007/s40263-024-01106-y",
        "default_evidence_note": (
            "Bundled Rett benchmark entry kept for reproducible comparison only; "
            "disease-specific support can range from approved symptomatic use to exploratory evidence."
        ),
    },
}


COMPOUND_LITERATURE: Final[dict[str, dict[str, str]]] = {
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
    "memantine": {
        "evidence_note": (
            "NMDA receptor antagonist widely used for moderate-to-severe Alzheimer symptom control."
        ),
    },
    "bromocriptine": {
        "evidence_note": (
            "Dopamine agonist historically used for Parkinsonian syndromes and related motor symptoms."
        ),
    },
    "lamotrigine": {
        "evidence_note": (
            "Antiepileptic sodium-channel blocker used in seizure stabilization and neuropsychiatric practice."
        ),
    },
    "valproic acid": {
        "evidence_note": (
            "Broad-spectrum antiepileptic used for seizure control; included here as a symptomatic neurologic comparator."
        ),
    },
    "vigabatrin": {
        "evidence_note": (
            "GABA-transaminase inhibitor used for refractory seizures and infantile spasms."
        ),
    },
    "cannabidiol": {
        "evidence_note": (
            "Neuroactive cannabinoid with antiseizure and anti-inflammatory evidence in neurologic disorders."
        ),
    },
    "risperidone": {
        "evidence_note": (
            "Atypical antipsychotic used for behavioural symptoms; not considered disease-modifying."
        ),
    },
    "melatonin": {
        "evidence_note": (
            "Circadian and antioxidant modulator frequently discussed as a neuroprotective adjunct."
        ),
    },
    "triheptanoin": {
        "evidence_note": (
            "Anaplerotic triglyceride investigated as metabolic support in neurologic and mitochondrial disorders."
        ),
    },
    "cysteamine": {
        "evidence_note": (
            "Small aminothiol with neuroprotective and lysosomal-disease relevance, included as an exploratory comparator."
        ),
    },
}


def get_sample_literature(sample_key: str) -> SampleLiteratureMetadata:
    """Devuelve los metadatos curatoriales para una muestra legacy conocida."""

    return SAMPLE_LITERATURE.get(sample_key, SAMPLE_LITERATURE["neuro"])


def enrich_bundled_sample_rows(
    sample_key: str,
    rows: list[CadmaCompoundRow],
) -> list[CadmaCompoundRow]:
    """Añade evidencia real y notas cautas a las filas bundled importadas.

    No inventa estudios específicos para cada molécula. Cuando no existe una
    entrada curada de alta confianza, conserva la referencia familiar real y una
    nota prudente indicando que la interpretación final debe revisarse en la
    literatura primaria.
    """

    family_meta = get_sample_literature(sample_key)
    enriched_rows: list[CadmaCompoundRow] = []
    for row in rows:
        normalized_name = row["name"].strip().lower()
        compound_meta = COMPOUND_LITERATURE.get(normalized_name, {})
        enriched_rows.append(
            {
                **row,
                "paper_reference": compound_meta.get(
                    "paper_reference",
                    row["paper_reference"].strip() or family_meta["paper_reference"],
                ).strip(),
                "paper_url": compound_meta.get(
                    "paper_url",
                    row["paper_url"].strip() or family_meta["paper_url"],
                ).strip(),
                "evidence_note": compound_meta.get(
                    "evidence_note",
                    row["evidence_note"].strip()
                    or family_meta["default_evidence_note"],
                ).strip(),
            }
        )
    return enriched_rows

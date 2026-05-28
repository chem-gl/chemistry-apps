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
    "7,8-dihydroxyflavone": {
        "paper_reference": (
            "From cannabinoids and neurosteroids to statins and the ketogenic diet: New therapeutic avenues in Rett syndrome?"
        ),
        "paper_url": "https://doi.org/10.3389/fnins.2019.00680",
        "evidence_note": (
            "TrkB receptor agonist (BDNF receptor); reviewed as a neuroprotective candidate in RTT for its ability to mimic BDNF signaling without requiring the protein itself."
        ),
    },
    "alanine": {
        "paper_reference": (
            "Treating Rett syndrome: From mouse models to human therapies"
        ),
        "paper_url": "https://doi.org/10.1007/s00335-019-09793-5",
        "evidence_note": (
            "Non-essential amino acid; reviewed within metabolic and nutritional strategies in RTT; role in the glucose-alanine cycle relevant to neuronal energy metabolism."
        ),
    },
    "allopregnanolone": {
        "paper_reference": (
            "Time-dependent modulation of GABAA-ergic synaptic transmission by allopregnanolone in locus coeruleus neurons of Mecp2-null mice"
        ),
        "paper_url": "https://doi.org/10.1152/ajpcell.00195.2013",
        "evidence_note": (
            "Endogenous neurosteroid and positive modulator of GABA-A receptors; time-dependently modulated GABAergic transmission in locus coeruleus neurons of Mecp2-null mice."
        ),
    },
    "benserazide": {
        "paper_reference": (
            "Altered trajectories of neurodevelopment and behavior in mouse models of Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/j.nlm.2018.11.007",
        "evidence_note": (
            "Peripheral dopa-decarboxylase inhibitor; combined with levodopa to increase central dopamine availability; evaluated in a RTT mouse model improving neurodevelopmental trajectories and behavior."
        ),
    },
    "blarcamesine": {
        "paper_reference": (
            "The new big is small: Leveraging knowledge from small trials for rare disease drug development: Blarcamesine for Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1111/bcp.15843",
        "evidence_note": (
            "Sigma-1 receptor agonist; evaluated in a clinical trial for RTT; a methodological study addressed how to leverage data from small trials for rare disease drug development."
        ),
    },
    "bromocriptine": {
        "paper_reference": (
            "Bromocriptine in the Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/s0387-7604(12)80329-9",
        "evidence_note": (
            "D2 dopaminergic agonist; one of the earliest drugs evaluated in RTT; early clinical study explored its effect on the dopaminergic dysfunction observed in the syndrome."
        ),
    },
    "cannabidiol": {
        "paper_reference": (
            "Cannabidiol therapy for refractory epilepsy and seizure disorders"
        ),
        "paper_url": "https://doi.org/10.1007/978-3-030-57369-0_7",
        "evidence_note": (
            "Non-psychoactive cannabinoid with antiepileptic activity; reviewed for refractory epilepsy and seizure disorders; proposed as an alternative for RTT patients with treatment-resistant epilepsy."
        ),
    },
    "cannabivarin": {
        "paper_reference": (
            "From cannabinoids and neurosteroids to statins and the ketogenic diet: New therapeutic avenues in Rett syndrome?"
        ),
        "paper_url": "https://doi.org/10.3389/fnins.2019.00680",
        "evidence_note": (
            "Phytocannabinoid analogue of cannabidiol with a shorter side chain; reviewed among cannabinoids and neurosteroids as possible therapeutic strategies in RTT."
        ),
    },
    "carbamazepine": {
        "paper_reference": (
            "Antiepileptic drugs in Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/j.ejpn.2015.02.007",
        "evidence_note": (
            "Sodium channel-blocking antiepileptic drug; documented in clinical use in RTT patients for seizure control; reviewed in a European multicenter study on antiepileptic drugs in RTT."
        ),
    },
    "citalopram": {
        "paper_reference": (
            "Fluoxetine rescues rotarod motor deficits in Mecp2 heterozygous mouse model of Rett syndrome via brain serotonin"
        ),
        "paper_url": "https://doi.org/10.1016/j.neuropharm.2020.108221",
        "evidence_note": (
            "SSRI reviewed in the context of serotonergic modulation in RTT; both citalopram and fluoxetine act on the serotonergic system which is disrupted in heterozygous Mecp2 mouse models."
        ),
    },
    "clenbuterol": {
        "paper_reference": (
            "Neurodevelopmental disorders: Righting Rett syndrome with IGF1"
        ),
        "paper_url": "https://doi.org/10.1038/nrd4417",
        "evidence_note": (
            "Beta-2 adrenergic agonist that stimulates IGF-1 production; proposed as a therapeutic strategy for RTT based on the IGF-1/PI3K signaling pathway."
        ),
    },
    "clonidine": {
        "paper_reference": (
            "Management of self-injurious behaviors in children with neurodevelopmental disorders: A pharmacotherapy overview"
        ),
        "paper_url": "https://doi.org/10.1002/phar.2238",
        "evidence_note": (
            "Central alpha-2 adrenergic agonist; reviewed for management of self-injurious behaviors and hyperactivity in neurodevelopmental disorders including RTT."
        ),
    },
    "curcumin": {
        "paper_reference": (
            "Vascular dysfunction in a mouse model of Rett syndrome and effects of curcumin treatment"
        ),
        "paper_url": "https://doi.org/10.1371/journal.pone.0064863",
        "evidence_note": (
            "Natural polyphenol with anti-inflammatory and antioxidant properties; corrected vascular dysfunction in a Mecp2-deficient RTT mouse model by improving vasodilatory responses."
        ),
    },
    "cx546": {
        "paper_reference": (
            "The enhancement of activity rescues the establishment of Mecp2 null neuronal phenotypes"
        ),
        "paper_url": "https://doi.org/10.15252/emmm.202012433",
        "evidence_note": (
            "Positive allosteric modulator of AMPA receptors (ampakine); rescued neuronal phenotypes in Mecp2-null cells by enhancing glutamatergic synaptic activity and neuronal plasticity."
        ),
    },
    "cysteamine": {
        "paper_reference": (
            "Unexpected link between Huntington disease and Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1051/medsci/2012281016",
        "evidence_note": (
            "Aminothiol with neuroprotective properties; identified through an unexpected link between Huntington disease and RTT; acts by elevating BDNF levels and reducing protein aggregate accumulation."
        ),
    },
    "desipramine": {
        "paper_reference": (
            "Effect of desipramine on patients with breathing disorders in Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1002/acn3.468",
        "evidence_note": (
            "Tricyclic antidepressant (norepinephrine reuptake inhibitor); demonstrated improvement of breathing disorders in RTT patients in a clinical trial specifically targeting apneas and hyperpneas."
        ),
    },
    "dextromethorphan": {
        "paper_reference": (
            "Randomized open-label trial of dextromethorphan in Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1212/WNL.0000000000004515",
        "evidence_note": (
            "NMDA antagonist and sigma-1 agonist; evaluated in a randomized open-label clinical trial in RTT; showed trends of improvement in some behavioral symptoms without strong statistical significance."
        ),
    },
    "diazepam": {
        "paper_reference": (
            "A case-controlled comparison of postoperative analgesic dosing between girls with Rett syndrome and girls with and without developmental disability undergoing spinal fusion surgery"
        ),
        "paper_url": "https://doi.org/10.1111/pan.13066",
        "evidence_note": (
            "GABA-A agonist benzodiazepine; studied in the context of postoperative pain management in girls with RTT undergoing spinal fusion surgery; useful for spasm and anxiety control."
        ),
    },
    "donepezil": {
        "paper_reference": (
            "Mecp2 deletion from cholinergic neurons selectively impairs recognition memory and disrupts cholinergic modulation of the perirhinal cortex"
        ),
        "paper_url": "https://doi.org/10.1523/ENEURO.0134-19.2019",
        "evidence_note": (
            "Acetylcholinesterase inhibitor; Mecp2 deletion in cholinergic neurons selectively impaired recognition memory and cholinergic modulation; Donepezil proposed to correct this deficit."
        ),
    },
    "fingolimod": {
        "paper_reference": (
            "Fingolimod in children with Rett syndrome: the FINGORETT study"
        ),
        "paper_url": "https://doi.org/10.1186/s13023-020-01655-7",
        "evidence_note": (
            "Sphingosine-1-phosphate receptor modulator evaluated in the FINGORETT clinical study in girls with Rett syndrome to reduce neuroinflammation and improve neurological function."
        ),
    },
    "fluoxetine": {
        "paper_reference": (
            "Fluoxetine increases brain MeCP2 immuno-positive cells in a female Mecp2 heterozygous mouse model of Rett syndrome through endogenous serotonin"
        ),
        "paper_url": "https://doi.org/10.1038/s41598-021-94156-x",
        "evidence_note": (
            "SSRI that increased MeCP2 immunopositive cells in heterozygous Mecp2 mice via endogenous serotonin; also rescued motor deficits in a heterozygous RTT mouse model."
        ),
    },
    "folic acid": {
        "paper_reference": (
            "Cerebral folate deficiency"
        ),
        "paper_url": "https://doi.org/10.1007/s10545-010-9159-6",
        "evidence_note": (
            "Vitamin B9; reviewed in the context of cerebral folate deficiency that can coexist with RTT; involved in neurotransmitter synthesis and DNA methylation."
        ),
    },
    "gentamicin": {
        "paper_reference": (
            "Evaluation of novel enhancer compounds in gentamicin-mediated readthrough of nonsense mutations in Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.3390/ijms241411665",
        "evidence_note": (
            "Aminoglycoside with nonsense mutation readthrough capacity; evaluated as an enhancer of functional MeCP2 protein production in MECP2 mutations that generate premature stop codons."
        ),
    },
    "glutamic acid": {
        "paper_reference": (
            "RIPK1 activation in Mecp2-deficient microglia promotes inflammation and glutamate release in RTT"
        ),
        "paper_url": "https://doi.org/10.1073/pnas.2320383121",
        "evidence_note": (
            "Excitatory neurotransmitter; RIPK1 activation in Mecp2-deficient microglia was shown to promote inflammation and excessive glutamate release in RTT pointing to the glutamatergic system as a therapeutic target."
        ),
    },
    "lamotrigine": {
        "paper_reference": (
            "Lamotrigine in two cases of Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/s0387-7604(01)00191-7",
        "evidence_note": (
            "Membrane-stabilizing antiepileptic drug; reported in two RTT clinical cases with seizure improvement; blocks sodium channels and modulates glutamate release."
        ),
    },
    "levodopa": {
        "paper_reference": (
            "Improvement of the Rett syndrome phenotype in a MeCP2 mouse model upon treatment with levodopa and a dopa-decarboxylase inhibitor"
        ),
        "paper_url": "https://doi.org/10.1038/npp.2014.136",
        "evidence_note": (
            "Dopamine precursor used together with a dopa-decarboxylase inhibitor; improved phenotype in MeCP2-mutant mice with effects on motor function and the dopaminergic system."
        ),
    },
    "lm22a-4": {
        "paper_reference": (
            "A small-molecule TrkB ligand improves dendritic spine phenotypes and atypical behaviors in female Rett syndrome mice"
        ),
        "paper_url": "https://doi.org/10.1101/2023.11.09.566435",
        "evidence_note": (
            "Small TrkB ligand (BDNF receptor); improved dendritic spine morphology and atypical behaviors in female RTT mice; promising preclinical results from a preprint study."
        ),
    },
    "lovastatin": {
        "paper_reference": (
            "Lovastatin fails to improve motor performance and survival in methyl-CpG-binding protein2-null mice"
        ),
        "paper_url": "https://doi.org/10.7554/eLife.22409",
        "evidence_note": (
            "HMG-CoA reductase inhibitor (statin); failed to improve motor performance and survival in Mecp2-null mice despite proposed neuroprotective mechanisms."
        ),
    },
    "lysine": {
        "paper_reference": (
            "Role of H3K4 demethylases in complex neurodevelopmental diseases"
        ),
        "paper_url": "https://doi.org/10.2217/epi.10.12",
        "evidence_note": (
            "Essential amino acid with a role in post-translational histone modifications (H3K4 methylation); reviewed in the epigenetic context of complex neurodevelopmental diseases including RTT."
        ),
    },
    "melatonin": {
        "paper_reference": (
            "Management of sleep disorders in children with neurodevelopmental disorders: A review"
        ),
        "paper_url": "https://doi.org/10.1002/phar.1686",
        "evidence_note": (
            "Neuroendocrine hormone with antioxidant properties; used in RTT for management of sleep disorders common in the syndrome; reviewed as part of pharmacological strategies in neurodevelopmental disorders."
        ),
    },
    "memantine": {
        "paper_reference": (
            "Is memantine a potential therapeutic for Rett syndrome?"
        ),
        "paper_url": "https://doi.org/10.3389/fnins.2013.00245",
        "evidence_note": (
            "Non-competitive NMDA receptor antagonist; proposed as therapy for RTT given the excitatory/inhibitory imbalance; systematic review of preclinical evidence."
        ),
    },
    "midazolam": {
        "paper_reference": (
            "The benzodiazepine Midazolam mitigates the breathing defects of Mecp2-deficient mice"
        ),
        "paper_url": "https://doi.org/10.1016/j.resp.2011.02.002",
        "evidence_note": (
            "Short-acting benzodiazepine; mitigated breathing defects in Mecp2-deficient mice by acting on GABA-A receptors in respiratory brainstem centers."
        ),
    },
    "mirtazapine": {
        "paper_reference": (
            "Mirtazapine treatment in a young female mouse model of Rett syndrome identifies time windows for the rescue of early phenotypes"
        ),
        "paper_url": "https://doi.org/10.1016/j.expneurol.2022.114056",
        "evidence_note": (
            "Noradrenergic and serotonergic antidepressant; identified critical time windows for rescue of early phenotypes in a young RTT mouse model; effective before full symptom onset."
        ),
    },
    "naltrexone": {
        "paper_reference": (
            "Rett syndrome: Controlled study of an oral opiate antagonist, naltrexone"
        ),
        "paper_url": "https://doi.org/10.1002/ana.410350415",
        "evidence_note": (
            "Opioid receptor antagonist; evaluated in a controlled trial in RTT; showed modest effects on breathing and behavior that were not sustained over time."
        ),
    },
    "picrotin": {
        "paper_reference": (
            "GABAA receptor antagonism ameliorates behavioral and synaptic impairments associated with MeCP2 overexpression"
        ),
        "paper_url": "https://doi.org/10.1038/npp.2014.43",
        "evidence_note": (
            "Inactive component of picrotoxin with a structure analogous to picrotoxinin; included as a structural reference; the study jointly evaluated GABA-A antagonism in the context of MeCP2 overexpression."
        ),
    },
    "picrotoxinin": {
        "paper_reference": (
            "GABAA receptor antagonism ameliorates behavioral and synaptic impairments associated with MeCP2 overexpression"
        ),
        "paper_url": "https://doi.org/10.1038/npp.2014.43",
        "evidence_note": (
            "Active component of picrotoxin; GABA-A receptor antagonist (chloride channel blocker); GABA-A antagonism ameliorated behavioral and synaptic impairments in mice overexpressing MeCP2."
        ),
    },
    "risperidone": {
        "paper_reference": (
            "Modulation of serotonin receptors in neurodevelopmental disorders: Focus on 5-HT7 receptor"
        ),
        "paper_url": "https://doi.org/10.3390/molecules26113348",
        "evidence_note": (
            "Atypical antipsychotic D2 and 5-HT2 antagonist; reviewed for modulation of serotonin receptors (especially 5-HT7) in neurodevelopmental disorders such as RTT; used for behavioral symptom management."
        ),
    },
    "sarizotan": {
        "paper_reference": (
            "Potent hERG channel inhibition by sarizotan, an investigative treatment for Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/j.yjmcc.2019.07.012",
        "evidence_note": (
            "5-HT1A agonist and partial D2 agonist; investigated for RTT to manage apneas; identified as a potent hERG channel inhibitor representing an important cardiac safety signal."
        ),
    },
    "tianeptine": {
        "paper_reference": (
            "Drug repurposing in Rett and Rett-like syndromes: A promising yet underrated opportunity?"
        ),
        "paper_url": "https://doi.org/10.3389/fmed.2024.1425038",
        "evidence_note": (
            "Atypical antidepressant modulating glutamate and serotonin; reviewed as a drug repurposing candidate for RTT and Rett-like syndromes."
        ),
    },
    "trazodone": {
        "paper_reference": (
            "Drug repurposing in Rett and Rett-like syndromes: A promising yet underrated opportunity?"
        ),
        "paper_url": "https://doi.org/10.3389/fmed.2024.1425038",
        "evidence_note": (
            "Serotonin reuptake inhibitor and 5-HT2 antagonist antidepressant; reviewed as a repurposing candidate for RTT in the context of mood and sleep symptoms."
        ),
    },
    "triheptanoin": {
        "paper_reference": (
            "Anaplerotic triheptanoin diet enhances mitochondrial substrate use to remodel the metabolome and improve lifespan, motor function, and sociability in MeCP2-null mice"
        ),
        "paper_url": "https://doi.org/10.1371/journal.pone.0109527",
        "evidence_note": (
            "Anaplerotic 7-carbon medium-chain triglyceride; improved mitochondrial function and lifespan in Mecp2-null mice by remodeling the brain metabolome."
        ),
    },
    "trofinetide": {
        "paper_reference": (
            "Trofinetide for the treatment of Rett syndrome: A randomized phase 3 study"
        ),
        "paper_url": "https://doi.org/10.1038/s41591-023-02398-1",
        "evidence_note": (
            "Synthetic IGF-1 analogue; FDA-approved in 2023 (Daybue) for RTT in patients aged 2 and older; demonstrated improvement in behavioral symptoms and global function in a phase 3 clinical trial."
        ),
    },
    "trolox": {
        "paper_reference": (
            "Systemic Radical Scavenger Treatment of a Mouse Model of Rett Syndrome: Merits and Limitations of the Vitamin E Derivative Trolox"
        ),
        "paper_url": "https://doi.org/10.3389/fncel.2016.00266",
        "evidence_note": (
            "Water-soluble vitamin E analogue with antioxidant activity; evaluated in RTT mice to reduce oxidative stress; showed partial benefits with long-term limitations."
        ),
    },
    "tyrosine": {
        "paper_reference": (
            "Biochemical and clinical effects of tyrosine and tryptophan in the Rett syndrome"
        ),
        "paper_url": "https://doi.org/10.1016/s0387-7604(12)80197-5",
        "evidence_note": (
            "Catecholamine precursor amino acid; studied in RTT for its biochemical effects on dopamine and serotonin metabolism in combination with tryptophan."
        ),
    },
    "valproic acid": {
        "paper_reference": (
            "SAMe, choline, and valproic acid as possible epigenetic drugs: Their effects in pregnancy with a special emphasis on animal studies"
        ),
        "paper_url": "https://doi.org/10.3390/ph15020192",
        "evidence_note": (
            "Antiepileptic drug with epigenetic properties (HDAC inhibitor); reviewed as an epigenetic agent with potential modulatory effect in RTT; also documented as a teratogen with a relevant risk profile."
        ),
    },
    "vatiquinone": {
        "paper_reference": (
            "Profile of Trofinetide in the treatment of Rett syndrome: Design, development and potential place in therapy"
        ),
        "paper_url": "https://doi.org/10.2147/DDDT.S383133",
        "evidence_note": (
            "Vitamin E analogue with mitochondrial antioxidant activity (15-LOX inhibitor); reviewed in the context of neuroprotection strategies in RTT alongside trofinetide."
        ),
    },
    "vigabatrin": {
        "paper_reference": (
            "Epileptic spasms in CDKL5 deficiency disorder: Delayed treatment and poor response to first-line therapies"
        ),
        "paper_url": "https://doi.org/10.1111/epi.17630",
        "evidence_note": (
            "Irreversible GABA-transaminase inhibitor antiepileptic; documented in epileptic spasms in CDKL5 deficiency disorder (RTT-related); variable response to first-line therapies reported."
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

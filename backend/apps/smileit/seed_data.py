"""seed_data.py: Definiciones canónicas de datos semilla para Smile-it.

Objetivo del archivo:
- Centralizar en un único lugar los valores de categorías, sustituyentes y
  patrones usados por el bootstrap inicial de Smile-it.
- Evitar duplicación entre migraciones, comandos de gestión y tests.

Cómo se usa:
- `migrations/0002_smileit_seed_data.py` consume estas definiciones para poblar
  la base de datos en una instalación fresca.
- `management/commands/regenerate_smileit_seed.py` reutiliza exactamente los
  mismos valores para regenerar el catálogo de forma idempotente.
- Los tests pueden tomar un subconjunto mínimo sin reescribir datos a mano.
"""

from __future__ import annotations

from dataclasses import dataclass

# Referencias bibliográficas reutilizadas por varias alertas (evita literales repetidos).
BENIGNI_BOSSA_REFERENCE = "Benigni & Bossa, Mutagenesis 2008 (OECD QSAR Toolbox)"
OECD_QSAR_REFERENCE = "OECD QSAR Toolbox v4 structural alerts (public documentation)"
KALGUTKAR_DIDIUK_REFERENCE = (
    "Kalgutkar & Didiuk, Chem Biol Drug Des 2013 (reactive metabolites)"
)
WELSCH_REFERENCE = "Welsch et al., Curr Opin Chem Biol 2010 (privileged scaffolds)"


@dataclass(frozen=True, slots=True)
class SmileitCategorySeedDefinition:
    """Describe una categoría verificable del catálogo semilla."""

    key: str
    name: str
    description: str
    verification_rule: str


@dataclass(frozen=True, slots=True)
class SmileitSubstituentSeedDefinition:
    """Describe un sustituyente semilla y sus categorías asociadas."""

    name: str
    smiles: str
    categories: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SmileitPatternSeedDefinition:
    """Describe un patrón estructural semilla del catálogo.

    `risk_category` clasifica el patrón por endpoint toxicológico y se persiste
    en `provenance_metadata` bajo `RISK_CATEGORY_METADATA_KEY`, sin cambios de
    esquema. `source_reference` documenta la fuente pública del alerta.
    """

    name: str
    smarts: str
    pattern_type: str
    risk_category: str
    caption: str
    source_reference: str = ""


CATEGORY_SEED_DEFINITIONS: tuple[SmileitCategorySeedDefinition, ...] = (
    SmileitCategorySeedDefinition(
        key="aromatic",
        name="Aromatic",
        description="Contains aromatic ring systems.",
        verification_rule="aromatic",
    ),
    SmileitCategorySeedDefinition(
        key="hbond_donor",
        name="Hydrogen Bond Donor",
        description="Contains donor atoms for hydrogen bonding.",
        verification_rule="hbond_donor",
    ),
    SmileitCategorySeedDefinition(
        key="hbond_acceptor",
        name="Hydrogen Bond Acceptor",
        description="Contains acceptor atoms for hydrogen bonding.",
        verification_rule="hbond_acceptor",
    ),
    SmileitCategorySeedDefinition(
        key="hydrophobic",
        name="Hydrophobic",
        description="Predominantly hydrophobic fragment.",
        verification_rule="hydrophobic",
    ),
)


SUBSTITUENT_SEED_DEFINITIONS: tuple[SmileitSubstituentSeedDefinition, ...] = (
    SmileitSubstituentSeedDefinition(
        name="Amine",
        smiles="[NH2]",
        categories=("hbond_donor", "hbond_acceptor"),
    ),
    SmileitSubstituentSeedDefinition(
        name="Alcohol",
        smiles="[OH]",
        categories=("hbond_donor", "hbond_acceptor"),
    ),
    SmileitSubstituentSeedDefinition(
        name="Aldehyde",
        smiles="[CH]=O",
        categories=("hbond_acceptor",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Benzene",
        smiles="c1ccccc1",
        categories=("aromatic", "hydrophobic"),
    ),
    SmileitSubstituentSeedDefinition(
        name="CarboxylicAcid",
        smiles="C(=O)O",
        categories=("hbond_donor", "hbond_acceptor"),
    ),
    SmileitSubstituentSeedDefinition(
        name="Chlorine",
        smiles="[Cl]",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Chloromethane",
        smiles="[CH2]Cl",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Dichloromethane",
        smiles="[CH](Cl)Cl",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Difluoromethane",
        smiles="[CH](F)F",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="EthylMethylAmine",
        smiles="N(C)(CC)",
        categories=("hbond_acceptor", "hydrophobic"),
    ),
    SmileitSubstituentSeedDefinition(
        name="Fluorine",
        smiles="[F]",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Fluoromethane",
        smiles="[CH2]F",
        categories=("hydrophobic",),
    ),
    SmileitSubstituentSeedDefinition(
        name="MethylEster",
        smiles="C(=O)OC",
        categories=("hbond_acceptor",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Methoxy",
        smiles="[O][CH3]",
        categories=("hbond_acceptor",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Nitro",
        smiles="[N+](=O)[O-]",
        categories=("hbond_acceptor",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Thiol",
        smiles="[SH]",
        categories=("hbond_donor",),
    ),
    SmileitSubstituentSeedDefinition(
        name="Trifluoromethane",
        smiles="[CH](F)(F)F",
        categories=("hydrophobic",),
    ),
)


RISK_CATEGORY_METADATA_KEY = "risk_category"
"""Clave de `provenance_metadata` donde viaja la categoría de riesgo del patrón.

Debe coincidir con `RISK_CATEGORY_METADATA_KEY` del frontend
(`frontend/src/app/smileit/smileit-risk.utils.ts`).
"""

RISK_CATEGORY_KEYS: frozenset[str] = frozenset(
    {
        "hepatotoxicity",
        "reactivity",
        "metabolic_interference",
        "mutagenicity_ames",
        "herg_cardiotoxicity",
        "genotoxicity",
        "privileged_scaffold",
    }
)


PATTERN_SEED_DEFINITIONS: tuple[SmileitPatternSeedDefinition, ...] = (
    # --- Hepatotoxicidad ------------------------------------------------
    SmileitPatternSeedDefinition(
        name="Aniline Hepatotoxicity Alert",
        smarts="c1ccccc1[NX3;H2,H1;!$(N-C=O)]",
        pattern_type="toxicophore",
        risk_category="hepatotoxicity",
        caption=(
            "Aniline nitrogen is oxidised to hydroxylamine and nitrenium "
            "species linked to hepatic injury."
        ),
        source_reference=(
            "Benigni & Bossa, Mutagenesis 2008 (OECD QSAR Toolbox); "
            "Kalgutkar & Didiuk, Chem Biol Drug Des 2013"
        ),
    ),
    SmileitPatternSeedDefinition(
        name="Nitroaromatic Hepatotoxicity Alert",
        smarts="c1ccccc1[NX3+](=O)[O-]",
        pattern_type="toxicophore",
        risk_category="hepatotoxicity",
        caption=(
            "Nitroaromatic groups undergo nitroreduction to nitroso and "
            "hydroxylamine metabolites that can injure the liver."
        ),
        source_reference=BENIGNI_BOSSA_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Thiocarbamate Hepatotoxicity Alert",
        smarts="[NX3][CX3](=[SX1])[SX2,OX2]",
        pattern_type="toxicophore",
        risk_category="hepatotoxicity",
        caption=(
            "Thiocarbamates are bioactivated to reactive sulfoxide and "
            "isothiocyanate intermediates associated with hepatotoxicity."
        ),
        source_reference=OECD_QSAR_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Hydrazine Hepatotoxicity Alert",
        smarts="[NX3]-[NX3]",
        pattern_type="toxicophore",
        risk_category="hepatotoxicity",
        caption=(
            "N-N bonds in hydrazines and hydrazides generate reactive "
            "nitrogen species that can cause hepatic necrosis."
        ),
        source_reference=OECD_QSAR_REFERENCE,
    ),
    # --- Reactividad intrínseca -----------------------------------------
    SmileitPatternSeedDefinition(
        name="Epoxide Reactivity Alert",
        smarts="[OX2;r3]1[CX4;r3][CX4;r3]1",
        pattern_type="toxicophore",
        risk_category="reactivity",
        caption=(
            "Strained oxirane rings are electrophiles that alkylate "
            "nucleophiles and drive covalent protein binding."
        ),
        source_reference=KALGUTKAR_DIDIUK_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Michael Acceptor Reactivity Alert",
        smarts="[CX3](=[OX1])[CX3]=[CX3]",
        pattern_type="toxicophore",
        risk_category="reactivity",
        caption=(
            "Alpha,beta-unsaturated carbonyls are soft electrophiles that "
            "adduct glutathione and protein thiols."
        ),
        source_reference=KALGUTKAR_DIDIUK_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Quinone Reactivity Alert",
        smarts="[OX1]=[CX3]1[CX3]=[CX3][CX3](=[OX1])[CX3]=[CX3]1",
        pattern_type="toxicophore",
        risk_category="reactivity",
        caption=(
            "Quinones arylate thiols and redox cycle, generating reactive "
            "oxygen species and protein adducts."
        ),
        source_reference=OECD_QSAR_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Alkyl Halide Reactivity Alert",
        smarts="[CX4][Cl,Br,I]",
        pattern_type="toxicophore",
        risk_category="reactivity",
        caption=(
            "sp3 carbons bearing chlorine, bromine or iodine are SN2 leaving "
            "groups that alkylate biological nucleophiles."
        ),
        source_reference=OECD_QSAR_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Isocyanate Reactivity Alert",
        smarts="[NX2]=[CX2]=[OX1]",
        pattern_type="toxicophore",
        risk_category="reactivity",
        caption=(
            "Isocyanates carbamoylate amines and proteins, a sensitisation "
            "and hepatotoxicity hazard."
        ),
        source_reference=KALGUTKAR_DIDIUK_REFERENCE,
    ),
    # --- Interferencia metabólica ---------------------------------------
    SmileitPatternSeedDefinition(
        name="Catechol Redox Cycling Alert",
        smarts="[OX2H]c1ccccc1[OX2H]",
        pattern_type="toxicophore",
        risk_category="metabolic_interference",
        caption=(
            "Catechols oxidise to ortho-quinones that deplete glutathione and "
            "propagate redox cycling and protein adducts."
        ),
        source_reference=OECD_QSAR_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Hydroquinone and p-Aminophenol Redox Alert",
        smarts="[OX2H]c1ccc([OX2H,NX3;H2,H1])cc1",
        pattern_type="toxicophore",
        risk_category="metabolic_interference",
        caption=(
            "Para-dihydroxy and para-aminophenol motifs oxidise to quinones "
            "and quinone imines that cause redox cycling and hepatic injury."
        ),
        source_reference=KALGUTKAR_DIDIUK_REFERENCE,
    ),
    # --- Mutagenicidad (Ames) -------------------------------------------
    SmileitPatternSeedDefinition(
        name="Aromatic Amine Ames Alert",
        smarts="[NX3;H2,H1;!$(N-C=O)]c1ccccc1",
        pattern_type="toxicophore",
        risk_category="mutagenicity_ames",
        caption=(
            "Primary aromatic amines are N-oxidised to nitrenium ions that "
            "form DNA adducts and give positive Ames results."
        ),
        source_reference=BENIGNI_BOSSA_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Azo Bond Ames Alert",
        smarts="[NX2]=[NX2]",
        pattern_type="toxicophore",
        risk_category="mutagenicity_ames",
        caption=(
            "Azo bonds are cleaved by azoreductases to aromatic amines and "
            "can be mutagenic in the Ames assay."
        ),
        source_reference=BENIGNI_BOSSA_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="N-Nitrosamine Ames Alert",
        smarts="[NX3][NX2]=[OX1]",
        pattern_type="toxicophore",
        risk_category="mutagenicity_ames",
        caption=(
            "N-Nitrosamines are activated to diazonium and carbonium ions "
            "that alkylate DNA, a potent Ames-positive alert."
        ),
        source_reference=BENIGNI_BOSSA_REFERENCE,
    ),
    # --- Cardiotoxicidad hERG -------------------------------------------
    SmileitPatternSeedDefinition(
        name="Lipophilic Tertiary Amine hERG Alert",
        smarts=("[NX3;H0;!$([N+]);!$(N-C=O);!$(N-C=S);!$(N-S(=O)=O);!$(N-N);!$(N-c)]"),
        pattern_type="toxicophore",
        risk_category="herg_cardiotoxicity",
        caption=(
            "Basic lipophilic tertiary amines bind the hERG channel, a major "
            "driver of QT prolongation."
        ),
        source_reference=(
            "Jamieson et al., J Med Chem 2006 (hERG pharmacophore); "
            "Aronov, J Med Chem 2005"
        ),
    ),
    SmileitPatternSeedDefinition(
        name="Aryl-Alkyl Amine hERG Alert",
        smarts="[c][CX4][NX3;H2,H1,H0;!$(N-C=O)]",
        pattern_type="toxicophore",
        risk_category="herg_cardiotoxicity",
        caption=(
            "Aryl-alkyl amines such as benzylamines stay basic and lipophilic "
            "enough to block hERG at therapeutic doses."
        ),
        source_reference="Aronov, J Med Chem 2005 (hERG blockers)",
    ),
    # --- Genotoxicidad (alquilantes) ------------------------------------
    SmileitPatternSeedDefinition(
        name="Nitrogen Mustard Genotoxicity Alert",
        smarts="[NX3][CX4][CX4][Cl,Br,I]",
        pattern_type="toxicophore",
        risk_category="genotoxicity",
        caption=(
            "Nitrogen mustards form aziridinium ions that alkylate and cross-link DNA."
        ),
        source_reference="Benigni & Bossa, Mutagenesis 2008 (alkylating agents)",
    ),
    SmileitPatternSeedDefinition(
        name="Methanesulfonate Genotoxicity Alert",
        smarts="[CX4;H3][SX4](=[OX1])(=[OX1])[OX2][CX4]",
        pattern_type="toxicophore",
        risk_category="genotoxicity",
        caption=(
            "Sulfonate esters are strong alkylating leaving groups that "
            "methylate DNA and other nucleophiles."
        ),
        source_reference="Benigni & Bossa, Mutagenesis 2008 (alkylating agents)",
    ),
    # --- Andamios privilegiados -----------------------------------------
    SmileitPatternSeedDefinition(
        name="Indole Privileged Scaffold",
        smarts="c1ccc2[nH]ccc2c1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption="Indole is a privileged scaffold with broad kinase and GPCR bioactivity.",
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Piperazine Privileged Scaffold",
        smarts="N1CCNCC1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Piperazine is a privileged saturated heterocycle used to tune "
            "basicity, solubility and binding interactions."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Quinoline Privileged Scaffold",
        smarts="c1ccc2ncccc2c1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Quinoline is a privileged aromatic scaffold frequent in kinase "
            "inhibitors and antimalarial ligands."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Benzimidazole Privileged Scaffold",
        smarts="c1ccc2[nH]cnc2c1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Benzimidazole is a privileged bicyclic scaffold that mimics "
            "purines and binds many target families."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Pyrimidine Privileged Scaffold",
        smarts="c1cncnc1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Pyrimidine is a privileged aromatic core in kinase inhibitors "
            "and nucleobase analogues."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Thiazole Privileged Scaffold",
        smarts="c1ncsc1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Thiazole is a privileged five-membered heteroaromatic that "
            "engages kinase hinges and metal centres."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Morpholine Privileged Scaffold",
        smarts="O1CCNCC1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Morpholine is a privileged saturated heterocycle used for "
            "solubility and basicity tuning."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
    SmileitPatternSeedDefinition(
        name="Pyrrolidine Privileged Scaffold",
        smarts="N1CCCC1",
        pattern_type="privileged",
        risk_category="privileged_scaffold",
        caption=(
            "Pyrrolidine is a privileged saturated amine that constrains "
            "basic substituents in ligand design."
        ),
        source_reference=WELSCH_REFERENCE,
    ),
)

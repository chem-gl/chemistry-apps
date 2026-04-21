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
    """Describe un patrón estructural semilla del catálogo."""

    name: str
    smarts: str
    pattern_type: str
    caption: str


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


PATTERN_SEED_DEFINITIONS: tuple[SmileitPatternSeedDefinition, ...] = (
    SmileitPatternSeedDefinition(
        name="Nitro Aromatic Alert",
        smarts="[NX3+](=O)[O-]",
        pattern_type="toxicophore",
        caption=(
            "Nitro group can be associated with toxicological alerts in "
            "medicinal chemistry."
        ),
    ),
    SmileitPatternSeedDefinition(
        name="Catechol Alert",
        smarts="c1ccc(c(c1)O)O",
        pattern_type="toxicophore",
        caption=(
            "Catechol-like motifs can undergo redox cycling and reactive metabolism."
        ),
    ),
    SmileitPatternSeedDefinition(
        name="Indole Privileged",
        smarts="c1ccc2[nH]ccc2c1",
        pattern_type="privileged",
        caption="Indole scaffold is a privileged motif in ligand design.",
    ),
    SmileitPatternSeedDefinition(
        name="Piperazine Privileged",
        smarts="N1CCNCC1",
        pattern_type="privileged",
        caption=(
            "Piperazine is frequently used to tune ADME and binding interactions."
        ),
    ),
)


MINIMAL_TEST_CATEGORY_KEYS: frozenset[str] = frozenset(
    {"aromatic", "hbond_donor", "hbond_acceptor", "hydrophobic"}
)
MINIMAL_TEST_SUBSTITUENT_NAMES: frozenset[str] = frozenset(
    {"Benzene", "Amine", "Chlorine"}
)
MINIMAL_TEST_PATTERN_NAMES: frozenset[str] = frozenset({"Nitro Aromatic Alert"})

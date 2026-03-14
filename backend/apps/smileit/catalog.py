"""catalog.py: Catálogo inicial de sustituyentes migrado del legado Java Smile-it.

Objetivo del archivo:
- Proveer la lista fija de sustituyentes que el legado Java cargaba en
  `FirstSubstituent.getMoleculeListInitializer()`.
- Exponer la función `get_initial_catalog()` como punto único de acceso.

Cómo se usa:
- `routers.py` lo llama para el endpoint GET /catalog.
- `plugin.py` no lo importa directamente; el catálogo llega por payload del job.
"""

from .types import SmileitCatalogEntry

# Catálogo migrado 1:1 desde FirstSubstituent.java (CDK 2.7.1 -> RDKit)
# Las notas "Over X" vienen del tercer argumento del constructor Molecule en el legado.
_INITIAL_CATALOG: list[SmileitCatalogEntry] = [
    SmileitCatalogEntry(
        name="Amine",
        smiles="[NH2]",
        description="Over Nitrogen",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Alcohol",
        smiles="[OH]",
        description="Over Oxygen",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Aldehyde",
        smiles="[CH]=O",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Benzene",
        smiles="c1ccccc1",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="CarboxylicAcid",
        smiles="C(=O)O",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Chlorine",
        smiles="[Cl]",
        description="Over Chlorine",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Chloromethane",
        smiles="[CH2]Cl",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Dichloromethane",
        smiles="[CH](Cl)Cl",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Difluoromethane",
        smiles="[CH](F)F",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="EthylMethylAmine",
        smiles="N(C)(CC)",
        description="Over Nitrogen",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Fluorine",
        smiles="[F]",
        description="Over Fluor",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Fluoromethane",
        smiles="[CH2]F",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="MethylEster",
        smiles="C(=O)OC",
        description="Over Carbon",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Methoxy",
        smiles="[O][CH3]",
        description="Over Oxygen",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Nitro",
        smiles="[N](=O)[O-]",
        description="Over Nitrogen",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Thiol",
        smiles="[SH]",
        description="Over Sulfur",
        selected_atom_index=0,
    ),
    SmileitCatalogEntry(
        name="Trifluoromethane",
        smiles="[CH](F)(F)F",
        description="Over Carbon",
        selected_atom_index=0,
    ),
]


def get_initial_catalog() -> list[SmileitCatalogEntry]:
    """Retorna una copia protegida del catálogo inicial de sustituyentes."""
    return list(_INITIAL_CATALOG)

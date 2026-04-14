# Generated manually - Inserts historical seed data for Smile-it categories, substituents, and patterns.

import uuid

from django.db import migrations


def seed_smileit_reference_data(apps, schema_editor) -> None:
    """Inserta datos semilla para categorías, sustituyentes y patrones iniciales.

    Estos datos se recuperaron del historial de git del commit 5c151c6.
    Restauran el catálogo base y patrones de Smile-it que se perdieron en migraciones anteriores.
    """

    category_model = apps.get_model("smileit", "SmileitCategory")
    substituent_model = apps.get_model("smileit", "SmileitSubstituent")
    link_model = apps.get_model("smileit", "SmileitSubstituentCategory")
    pattern_model = apps.get_model("smileit", "SmileitPattern")

    # ============================================================================
    # CATEGORÍAS QUÍMICAS VERIFICABLES
    # ============================================================================
    category_data = [
        {
            "key": "aromatic",
            "name": "Aromatic",
            "description": "Contains aromatic ring systems.",
            "verification_rule": "aromatic",
        },
        {
            "key": "hbond_donor",
            "name": "Hydrogen Bond Donor",
            "description": "Contains donor atoms for hydrogen bonding.",
            "verification_rule": "hbond_donor",
        },
        {
            "key": "hbond_acceptor",
            "name": "Hydrogen Bond Acceptor",
            "description": "Contains acceptor atoms for hydrogen bonding.",
            "verification_rule": "hbond_acceptor",
        },
        {
            "key": "hydrophobic",
            "name": "Hydrophobic",
            "description": "Predominantly hydrophobic fragment.",
            "verification_rule": "hydrophobic",
        },
    ]

    categories_by_key = {}
    for row in category_data:
        # Evitar duplicados: usa get_or_create para idempotencia
        category, created = category_model.objects.get_or_create(
            key=row["key"],
            version=1,
            defaults={
                "is_latest": True,
                "is_active": True,
                "name": row["name"],
                "description": row["description"],
                "verification_rule": row["verification_rule"],
                "verification_smarts": "",
            },
        )
        categories_by_key[row["key"]] = category

    # ============================================================================
    # SUSTITUYENTES SEMILLA CON ASIGNACIONES DE CATEGORÍA
    # ============================================================================
    substituent_data = [
        {
            "name": "Amine",
            "smiles": "[NH2]",
            "categories": ["hbond_donor", "hbond_acceptor"],
        },
        {
            "name": "Alcohol",
            "smiles": "[OH]",
            "categories": ["hbond_donor", "hbond_acceptor"],
        },
        {"name": "Aldehyde", "smiles": "[CH]=O", "categories": ["hbond_acceptor"]},
        {
            "name": "Benzene",
            "smiles": "c1ccccc1",
            "categories": ["aromatic", "hydrophobic"],
        },
        {
            "name": "CarboxylicAcid",
            "smiles": "C(=O)O",
            "categories": ["hbond_donor", "hbond_acceptor"],
        },
        {"name": "Chlorine", "smiles": "[Cl]", "categories": ["hydrophobic"]},
        {"name": "Chloromethane", "smiles": "[CH2]Cl", "categories": ["hydrophobic"]},
        {
            "name": "Dichloromethane",
            "smiles": "[CH](Cl)Cl",
            "categories": ["hydrophobic"],
        },
        {
            "name": "Difluoromethane",
            "smiles": "[CH](F)F",
            "categories": ["hydrophobic"],
        },
        {
            "name": "EthylMethylAmine",
            "smiles": "N(C)(CC)",
            "categories": ["hbond_acceptor", "hydrophobic"],
        },
        {"name": "Fluorine", "smiles": "[F]", "categories": ["hydrophobic"]},
        {"name": "Fluoromethane", "smiles": "[CH2]F", "categories": ["hydrophobic"]},
        {"name": "MethylEster", "smiles": "C(=O)OC", "categories": ["hbond_acceptor"]},
        {"name": "Methoxy", "smiles": "[O][CH3]", "categories": ["hbond_acceptor"]},
        {"name": "Nitro", "smiles": "[N+](=O)[O-]", "categories": ["hbond_acceptor"]},
        {"name": "Thiol", "smiles": "[SH]", "categories": ["hbond_donor"]},
        {
            "name": "Trifluoromethane",
            "smiles": "[CH](F)(F)F",
            "categories": ["hydrophobic"],
        },
    ]

    for item in substituent_data:
        # Evitar duplicados por nombre
        substituent, created = substituent_model.objects.get_or_create(
            name=item["name"],
            version=1,
            defaults={
                "stable_id": uuid.uuid4(),
                "is_latest": True,
                "is_active": True,
                "smiles_input": item["smiles"],
                "smiles_canonical": item["smiles"],
                "anchor_atom_indices": [0],
                "source_reference": "legacy-smileit",
                "provenance_metadata": {"seed": True},
            },
        )

        # Crear asignaciones de categoría (idempotente con get_or_create)
        for category_key in item["categories"]:
            link_model.objects.get_or_create(
                substituent=substituent,
                category=categories_by_key[category_key],
                defaults={
                    "verification_passed": True,
                    "verification_message": "Seed category assignment.",
                },
            )

    # ============================================================================
    # PATRONES ESTRUCTURALES (TOXICÓFOROS Y PRIVILEGIADOS)
    # ============================================================================
    pattern_data = [
        {
            "name": "Nitro Aromatic Alert",
            "smarts": "[NX3+](=O)[O-]",
            "pattern_type": "toxicophore",
            "caption": "Nitro group can be associated with toxicological alerts in medicinal chemistry.",
        },
        {
            "name": "Catechol Alert",
            "smarts": "c1ccc(c(c1)O)O",
            "pattern_type": "toxicophore",
            "caption": "Catechol-like motifs can undergo redox cycling and reactive metabolism.",
        },
        {
            "name": "Indole Privileged",
            "smarts": "c1ccc2[nH]ccc2c1",
            "pattern_type": "privileged",
            "caption": "Indole scaffold is a privileged motif in ligand design.",
        },
        {
            "name": "Piperazine Privileged",
            "smarts": "N1CCNCC1",
            "pattern_type": "privileged",
            "caption": "Piperazine is frequently used to tune ADME and binding interactions.",
        },
    ]

    for item in pattern_data:
        # Evitar duplicados por nombre + type
        pattern, created = pattern_model.objects.get_or_create(
            name=item["name"],
            pattern_type=item["pattern_type"],
            version=1,
            defaults={
                "stable_id": uuid.uuid4(),
                "is_latest": True,
                "is_active": True,
                "smarts": item["smarts"],
                "caption": item["caption"],
                "source_reference": "smileit-seed",
                "provenance_metadata": {"seed": True},
            },
        )


def reverse_seed_data(apps, schema_editor) -> None:
    """Marca los datos semilla como inactivos en vez de borrarlos (conserva trazabilidad)."""
    category_model = apps.get_model("smileit", "SmileitCategory")
    substituent_model = apps.get_model("smileit", "SmileitSubstituent")
    pattern_model = apps.get_model("smileit", "SmileitPattern")

    # Desactivar categorías semilla
    category_model.objects.filter(
        source_reference="smileit-seed",
    ).update(is_active=False)

    # Desactivar sustituyentes semilla
    substituent_model.objects.filter(
        source_reference="legacy-smileit",
        provenance_metadata__seed=True,
    ).update(is_active=False)

    # Desactivar patrones semilla
    pattern_model.objects.filter(
        source_reference="smileit-seed",
        provenance_metadata__seed=True,
    ).update(is_active=False)


class Migration(migrations.Migration):
    """Restaura datos semilla históricos para categorías, sustituyentes y patrones de Smile-it.

    Estos datos se recuperaron del commit 5c151c6.
    La migración es idempotente: puede ejecutarse múltiples veces sin duplicar datos.
    """

    dependencies = [
        ("smileit", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            seed_smileit_reference_data,
            reverse_seed_data,
        )
    ]

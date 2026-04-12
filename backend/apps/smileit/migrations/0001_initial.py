"""0001_initial.py: Migración inicial de Smile-it.

Modelos que crea:
  SmileitCategory              — categorías de grupos funcionales químicos.
  SmileitSubstituent           — fragmentos químicos nombrados y versionados.
  SmileitPattern               — patrones SMARTS para toxicóforos y motivos privilegiados.
  SmileitSubstituentCategory   — tabla de unión many-to-many con verificación.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import migrations, models


def seed_smileit_reference_data(apps, schema_editor) -> None:
    """Inserta datos semilla para categorías, sustituyentes y patrones iniciales."""

    category_model = apps.get_model("smileit", "SmileitCategory")
    substituent_model = apps.get_model("smileit", "SmileitSubstituent")
    link_model = apps.get_model("smileit", "SmileitSubstituentCategory")
    pattern_model = apps.get_model("smileit", "SmileitPattern")

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
        category = category_model.objects.create(
            key=row["key"],
            version=1,
            is_latest=True,
            is_active=True,
            name=row["name"],
            description=row["description"],
            verification_rule=row["verification_rule"],
            verification_smarts="",
        )
        categories_by_key[row["key"]] = category

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
        stable_id = uuid.uuid4()
        # Canonicalizar el SMILES y calcular el anchor correcto en el espacio canónico.
        # Sin este paso, el anchor_atom_indices=0 refiere al índice del SMILES input,
        # que puede diferir del índice 0 del SMILES canónico (p.ej. 'C(=O)O' → 'O=CO').
        from rdkit import (
            Chem,  # noqa: PLC0415 (import local para no afectar el módulo de migración)
        )

        mol_input = Chem.MolFromSmiles(item["smiles"])
        canonical_smiles = Chem.MolToSmiles(mol_input, isomericSmiles=True)
        mol_canonical = Chem.MolFromSmiles(canonical_smiles)
        # match[original_idx] = canonical_idx
        match = mol_canonical.GetSubstructMatch(mol_input)
        anchor_canonical = match[0] if match else 0

        substituent = substituent_model.objects.create(
            stable_id=stable_id,
            version=1,
            is_latest=True,
            is_active=True,
            name=item["name"],
            smiles_input=item["smiles"],
            smiles_canonical=canonical_smiles,
            anchor_atom_indices=[anchor_canonical],
            source_reference="legacy-smileit",
            provenance_metadata={"seed": True},
        )
        for category_key in item["categories"]:
            link_model.objects.create(
                substituent=substituent,
                category=categories_by_key[category_key],
                verification_passed=True,
                verification_message="Seed category assignment.",
            )

    pattern_data = [
        {
            "stable_id": uuid.UUID("bee090e8-b983-4775-b564-74565f34c66a"),
            "name": "Indole Privileged",
            "smarts": "c1ccc2[nH]ccc2c1",
            "pattern_type": "privileged",
            "caption": "Indole scaffold is a privileged motif in ligand design.",
        },
        {
            "stable_id": uuid.UUID("a2034040-41bc-4dad-9d8d-8acd1a117093"),
            "name": "Piperazine Privileged",
            "smarts": "N1CCNCC1",
            "pattern_type": "privileged",
            "caption": "Piperazine is frequently used to tune ADME and binding interactions.",
        },
        {
            "stable_id": uuid.UUID("c8e17fd9-76dd-4ccb-8cb3-367aa4f38ebe"),
            "name": "Catechol Alert",
            "smarts": "c1ccc(c(c1)O)O",
            "pattern_type": "toxicophore",
            "caption": "Catechol-like motifs can undergo redox cycling and reactive metabolism.",
        },
        {
            "stable_id": uuid.UUID("967a0246-200a-4b68-b75e-7a3e77ee77d9"),
            "name": "Nitro Aromatic Alert",
            "smarts": "[NX3+](=O)[O-]",
            "pattern_type": "toxicophore",
            "caption": (
                "Nitro group can be associated with toxicological alerts in "
                "medicinal chemistry."
            ),
        },
    ]

    for item in pattern_data:
        pattern_model.objects.create(
            stable_id=item["stable_id"],
            version=1,
            is_latest=True,
            is_active=True,
            name=item["name"],
            smarts=item["smarts"],
            pattern_type=item["pattern_type"],
            caption=item["caption"],
            source_reference="smileit-seed",
            provenance_metadata={"seed": True, "canonical_seed": True},
        )


class Migration(migrations.Migration):
    """Esquema inicial para Smile-it persistente."""

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SmileitCategory",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("key", models.SlugField(max_length=80)),
                ("version", models.PositiveIntegerField(default=1)),
                ("is_latest", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("name", models.CharField(max_length=120)),
                ("description", models.CharField(max_length=300)),
                (
                    "verification_rule",
                    models.CharField(
                        choices=[
                            ("aromatic", "Aromatic"),
                            ("hbond_donor", "Hydrogen Bond Donor"),
                            ("hbond_acceptor", "Hydrogen Bond Acceptor"),
                            ("hydrophobic", "Hydrophobic"),
                            ("smarts", "SMARTS Pattern"),
                        ],
                        max_length=30,
                    ),
                ),
                (
                    "verification_smarts",
                    models.CharField(blank=True, default="", max_length=2000),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name="smileit_categories",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["key", "-version"]},
        ),
        migrations.CreateModel(
            name="SmileitPattern",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "stable_id",
                    models.UUIDField(db_index=True, default=uuid.uuid4, editable=False),
                ),
                ("version", models.PositiveIntegerField(default=1)),
                ("is_latest", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("name", models.CharField(max_length=140)),
                ("smarts", models.CharField(max_length=2000)),
                (
                    "pattern_type",
                    models.CharField(
                        choices=[
                            ("toxicophore", "Toxicophore"),
                            ("privileged", "Privileged"),
                        ],
                        max_length=30,
                    ),
                ),
                ("caption", models.CharField(max_length=300)),
                (
                    "source_reference",
                    models.CharField(blank=True, default="", max_length=200),
                ),
                ("provenance_metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["pattern_type", "name", "-version"]},
        ),
        migrations.CreateModel(
            name="SmileitSubstituent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "stable_id",
                    models.UUIDField(db_index=True, default=uuid.uuid4, editable=False),
                ),
                ("version", models.PositiveIntegerField(default=1)),
                ("is_latest", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("name", models.CharField(max_length=120)),
                ("smiles_input", models.CharField(max_length=2000)),
                ("smiles_canonical", models.CharField(db_index=True, max_length=2000)),
                ("anchor_atom_indices", models.JSONField(default=list)),
                (
                    "source_reference",
                    models.CharField(blank=True, default="", max_length=200),
                ),
                ("provenance_metadata", models.JSONField(blank=True, default=dict)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name="smileit_substituents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name", "-version"]},
        ),
        migrations.CreateModel(
            name="SmileitSubstituentCategory",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("verification_passed", models.BooleanField(default=True)),
                (
                    "verification_message",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="substituent_links",
                        to="smileit.smileitcategory",
                    ),
                ),
                (
                    "substituent",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="category_links",
                        to="smileit.smileitsubstituent",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="smileitsubstituent",
            name="categories",
            field=models.ManyToManyField(
                related_name="substituents",
                through="smileit.SmileitSubstituentCategory",
                to="smileit.smileitcategory",
            ),
        ),
        migrations.AddConstraint(
            model_name="smileitcategory",
            constraint=models.UniqueConstraint(
                fields=("key", "version"), name="unique_smileit_category_key_version"
            ),
        ),
        migrations.AddConstraint(
            model_name="smileitcategory",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("verification_rule", "smarts"),
                        models.Q(("verification_smarts", ""), _negated=True),
                    ),
                    models.Q(
                        models.Q(("verification_rule", "smarts"), _negated=True),
                        ("verification_smarts", ""),
                    ),
                    _connector="OR",
                ),
                name="smileit_category_smarts_rule_consistency",
            ),
        ),
        migrations.AddConstraint(
            model_name="smileitpattern",
            constraint=models.UniqueConstraint(
                fields=("stable_id", "version"),
                name="unique_smileit_pattern_stable_version",
            ),
        ),
        migrations.AddConstraint(
            model_name="smileitsubstituent",
            constraint=models.UniqueConstraint(
                fields=("stable_id", "version"),
                name="unique_smileit_substituent_stable_version",
            ),
        ),
        migrations.AddConstraint(
            model_name="smileitsubstituentcategory",
            constraint=models.UniqueConstraint(
                fields=("substituent", "category"),
                name="unique_smileit_substituent_category",
            ),
        ),
        migrations.AddIndex(
            model_name="smileitcategory",
            index=models.Index(
                fields=["key", "is_latest"], name="smileit_smi_key_21b494_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="smileitcategory",
            index=models.Index(
                fields=["is_active"], name="smileit_smi_is_acti_d158a2_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="smileitsubstituent",
            index=models.Index(
                fields=["stable_id", "is_latest"], name="smileit_smi_stable__4c424c_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="smileitsubstituent",
            index=models.Index(
                fields=["is_active"], name="smileit_smi_is_acti_1329c4_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="smileitsubstituentcategory",
            index=models.Index(
                fields=["category", "substituent"],
                name="smileit_smi_categor_ed1cde_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="smileitpattern",
            index=models.Index(
                fields=["pattern_type", "is_active"],
                name="smileit_smi_pattern_ac82b2_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="smileitpattern",
            index=models.Index(
                fields=["stable_id", "is_latest"], name="smileit_smi_stable__b7616f_idx"
            ),
        ),
        migrations.RunPython(seed_smileit_reference_data, migrations.RunPython.noop),
    ]

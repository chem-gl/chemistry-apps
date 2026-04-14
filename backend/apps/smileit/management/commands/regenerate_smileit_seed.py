"""management/commands/regenerate_smileit_seed.py: Regenera datos semilla de Smile-it.

Comando para restablecer el catálogo, categorías y patrones iniciales de Smile-it.
Útil si se borran migraciones o si necesitas reinicializar los datos sin migrar.

Uso:
    poetry run python manage.py regenerate_smileit_seed
    poetry run python manage.py regenerate_smileit_seed --reset  # Borra primero
"""

from __future__ import annotations

import uuid

from django.core.management.base import BaseCommand

from apps.smileit.models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)


class Command(BaseCommand):
    """Regenera datos semilla de Smile-it (categorías, sustituyentes, patrones)."""

    help = "Regenera datos semilla de Smile-it. Usa --reset para borrar y reiniciar."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Borra todos los datos de Smile-it antes de regenerar (DESTRUCTIVO).",
        )

    def handle(self, *args: object, **options: object) -> None:
        reset = bool(options.get("reset", False))

        if reset:
            self.stdout.write(
                self.style.WARNING(
                    "⚠️  Borrando todos los datos de Smile-it (categorías, sustituyentes, patrones)..."
                )
            )
            SmileitCategory.objects.all().delete()
            SmileitSubstituent.objects.all().delete()
            SmileitPattern.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("✓ Datos borrados."))

        self.stdout.write("Regenerando datos semilla de Smile-it...")
        self._seed_categories()
        self._seed_substituents()
        self._seed_patterns()
        self.stdout.write(
            self.style.SUCCESS("✓ Datos semilla de Smile-it regenerados correctamente.")
        )

    def _seed_categories(self) -> None:
        """Crea categorías químicas verificables."""
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

        for row in category_data:
            _, created = SmileitCategory.objects.get_or_create(
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
            status = "creada" if created else "existente"
            self.stdout.write(f"  Categoría '{row['key']}': {status}")

    def _seed_substituents(self) -> None:
        """Crea sustituyentes semilla con asignaciones de categoría."""
        # Obtener categorías ya creadas
        categories_by_key = {
            cat.key: cat
            for cat in SmileitCategory.objects.filter(is_latest=True, is_active=True)
        }

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
            {
                "name": "Chloromethane",
                "smiles": "[CH2]Cl",
                "categories": ["hydrophobic"],
            },
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
            {
                "name": "Fluoromethane",
                "smiles": "[CH2]F",
                "categories": ["hydrophobic"],
            },
            {
                "name": "MethylEster",
                "smiles": "C(=O)OC",
                "categories": ["hbond_acceptor"],
            },
            {
                "name": "Methoxy",
                "smiles": "[O][CH3]",
                "categories": ["hbond_acceptor"],
            },
            {
                "name": "Nitro",
                "smiles": "[N+](=O)[O-]",
                "categories": ["hbond_acceptor"],
            },
            {"name": "Thiol", "smiles": "[SH]", "categories": ["hbond_donor"]},
            {
                "name": "Trifluoromethane",
                "smiles": "[CH](F)(F)F",
                "categories": ["hydrophobic"],
            },
        ]

        for item in substituent_data:
            substituent, created = SmileitSubstituent.objects.get_or_create(
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
            status = "creado" if created else "existente"
            self.stdout.write(f"  Sustituyente '{item['name']}': {status}")

            # Crear asignaciones de categoría
            for category_key in item["categories"]:
                SmileitSubstituentCategory.objects.get_or_create(
                    substituent=substituent,
                    category=categories_by_key[category_key],
                    defaults={
                        "verification_passed": True,
                        "verification_message": "Seed category assignment.",
                    },
                )

    def _seed_patterns(self) -> None:
        """Crea patrones estructurales (toxicóforos y privilegiados)."""
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
            _, created = SmileitPattern.objects.get_or_create(
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
            status = "creado" if created else "existente"
            self.stdout.write(f"  Patrón '{item['name']}': {status}")

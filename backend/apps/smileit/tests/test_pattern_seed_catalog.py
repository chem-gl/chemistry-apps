"""test_pattern_seed_catalog.py: Contrato del catálogo semilla de patrones de Smile-it.

Objetivo del archivo:
- Congelar el contrato del catálogo de patrones toxicológicos: categoría de
  riesgo declarada, fuentes públicas, SMARTS válidos y ausencia de duplicados.
- Verificar que la anotación estructural pinta rojo los toxicóforos y verde los
  andamios privilegiados usando las reglas reales del catálogo.
- Verificar que `apply_smileit_seed_data` propaga `risk_category` y
  `source_reference` al registro persistido.

Cómo se usa:
- `poetry run python manage.py test apps.smileit.tests.test_pattern_seed_catalog`
"""

from __future__ import annotations

from django.test import SimpleTestCase, TestCase
from rdkit import Chem

from ..catalog import (
    delete_pattern_entry,
    list_active_patterns,
    update_pattern_entry,
)
from ..engine.verification import collect_pattern_annotations
from ..models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)
from ..seed_bootstrap import apply_smileit_seed_data, deactivate_smileit_seed_data
from ..seed_data import (
    PATTERN_SEED_DEFINITIONS,
    RISK_CATEGORY_KEYS,
    RISK_CATEGORY_METADATA_KEY,
)
from ..types import SmileitPatternCreatePayload, SmileitPatternEntry

TOXICOPHORE_COLOR = "#d93a2f"
PRIVILEGED_COLOR = "#2f9e44"

REQUIRED_RISK_CATEGORIES: frozenset[str] = frozenset(
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

REQUIRED_PRIVILEGED_SCAFFOLDS: frozenset[str] = frozenset(
    {
        "Indole",
        "Piperazine",
        "Quinoline",
        "Benzimidazole",
        "Pyrimidine",
        "Thiazole",
        "Morpholine",
        "Pyrrolidine",
    }
)

# Muestras mínimas para comprobar que cada alerta dispara donde debe.
ALERT_PROBES: tuple[tuple[str, str, str], ...] = (
    ("aniline", "Nc1ccccc1", "hepatotoxicity"),
    ("nitroaromatic", "O=[N+]([O-])c1ccccc1", "hepatotoxicity"),
    ("thiocarbamate", "CN(C)C(=S)SC", "hepatotoxicity"),
    ("hydrazine", "NNC(=O)C", "hepatotoxicity"),
    ("epoxide", "CC1CO1", "reactivity"),
    ("michael_acceptor", "CC(=O)C=C", "reactivity"),
    ("quinone", "O=C1C=CC(=O)C=C1", "reactivity"),
    ("alkyl_halide", "CCBr", "reactivity"),
    ("isocyanate", "O=C=Nc1ccccc1", "reactivity"),
    ("catechol", "Oc1ccccc1O", "metabolic_interference"),
    ("hydroquinone", "Oc1ccc(O)cc1", "metabolic_interference"),
    ("aromatic_amine", "Nc1ccccc1", "mutagenicity_ames"),
    ("azo", "c1ccc(N=Nc2ccccc2)cc1", "mutagenicity_ames"),
    ("nitrosamine", "CN(N=O)C", "mutagenicity_ames"),
    ("tertiary_amine", "CCN1CCCCC1", "herg_cardiotoxicity"),
    ("benzylamine", "c1ccccc1CN", "herg_cardiotoxicity"),
    ("nitrogen_mustard", "ClCCN(CCCl)C", "genotoxicity"),
    ("mesylate", "COS(=O)(=O)C", "genotoxicity"),
)


def _seed_pattern_entries() -> list[SmileitPatternEntry]:
    """Convierte el catálogo semilla en entradas anotables por el motor."""
    return [
        SmileitPatternEntry(
            id=f"seed-{index}",
            stable_id=f"seed-stable-{index}",
            version=1,
            name=seed.name,
            smarts=seed.smarts,
            pattern_type=seed.pattern_type,
            caption=seed.caption,
            source_reference=seed.source_reference,
            provenance_metadata={RISK_CATEGORY_METADATA_KEY: seed.risk_category},
        )
        for index, seed in enumerate(PATTERN_SEED_DEFINITIONS)
    ]


class SmileitPatternSeedCatalogContractTests(SimpleTestCase):
    """Valida las invariantes estáticas del catálogo semilla de patrones."""

    def test_pattern_count_within_expected_range(self) -> None:
        self.assertGreaterEqual(len(PATTERN_SEED_DEFINITIONS), 22)
        self.assertLessEqual(len(PATTERN_SEED_DEFINITIONS), 26)

    def test_every_rule_declares_allowed_risk_category(self) -> None:
        for seed in PATTERN_SEED_DEFINITIONS:
            with self.subTest(rule=seed.name):
                self.assertIn(seed.risk_category, RISK_CATEGORY_KEYS)

    def test_every_rule_has_caption_and_source_reference(self) -> None:
        for seed in PATTERN_SEED_DEFINITIONS:
            with self.subTest(rule=seed.name):
                self.assertTrue(seed.caption.strip())
                self.assertTrue(seed.source_reference.strip())

    def test_every_smarts_parses_with_rdkit(self) -> None:
        for seed in PATTERN_SEED_DEFINITIONS:
            with self.subTest(rule=seed.name):
                self.assertIsNotNone(Chem.MolFromSmarts(seed.smarts))

    def test_no_duplicate_smarts_within_same_risk_category(self) -> None:
        seen: dict[tuple[str, str], str] = {}
        for seed in PATTERN_SEED_DEFINITIONS:
            key = (seed.risk_category, seed.smarts)
            with self.subTest(rule=seed.name):
                self.assertNotIn(
                    key, seen, msg=f"SMARTS repetido en {seed.risk_category}"
                )
            seen[key] = seed.name

    def test_unique_rule_names(self) -> None:
        names = [seed.name for seed in PATTERN_SEED_DEFINITIONS]
        self.assertEqual(len(names), len(set(names)))

    def test_all_required_risk_categories_are_present(self) -> None:
        declared = {seed.risk_category for seed in PATTERN_SEED_DEFINITIONS}
        self.assertEqual(declared, REQUIRED_RISK_CATEGORIES)

    def test_privileged_rules_use_privileged_pattern_type(self) -> None:
        for seed in PATTERN_SEED_DEFINITIONS:
            with self.subTest(rule=seed.name):
                expected_type = (
                    "privileged"
                    if seed.risk_category == "privileged_scaffold"
                    else "toxicophore"
                )
                self.assertEqual(seed.pattern_type, expected_type)

    def test_required_privileged_scaffolds_are_present(self) -> None:
        privileged_names = {
            seed.name.split(" ")[0]
            for seed in PATTERN_SEED_DEFINITIONS
            if seed.risk_category == "privileged_scaffold"
        }
        self.assertEqual(privileged_names, REQUIRED_PRIVILEGED_SCAFFOLDS)

    def test_every_category_has_at_least_one_rule(self) -> None:
        for category_key in REQUIRED_RISK_CATEGORIES:
            with self.subTest(category=category_key):
                self.assertTrue(
                    any(
                        seed.risk_category == category_key
                        for seed in PATTERN_SEED_DEFINITIONS
                    )
                )

    def test_every_toxicophore_category_matches_its_probe_molecule(self) -> None:
        for label, smiles, expected_category in ALERT_PROBES:
            molecule = Chem.MolFromSmiles(smiles)
            with self.subTest(probe=label):
                self.assertIsNotNone(molecule)
                matched = any(
                    seed.risk_category == expected_category
                    and molecule.HasSubstructMatch(Chem.MolFromSmarts(seed.smarts))
                    for seed in PATTERN_SEED_DEFINITIONS
                )
                self.assertTrue(
                    matched,
                    msg=f"Ninguna regla de {expected_category} casa con {label}",
                )

    def test_privileged_scaffold_rules_match_their_probe_molecule(self) -> None:
        probes = {
            "Indole": "c1ccc2[nH]ccc2c1",
            "Piperazine": "N1CCNCC1",
            "Quinoline": "c1ccc2ncccc2c1",
            "Benzimidazole": "c1ccc2[nH]cnc2c1",
            "Pyrimidine": "c1cncnc1",
            "Thiazole": "c1ncsc1",
            "Morpholine": "O1CCNCC1",
            "Pyrrolidine": "N1CCCC1",
        }
        for name, smiles in probes.items():
            molecule = Chem.MolFromSmiles(smiles)
            seed = next(
                candidate
                for candidate in PATTERN_SEED_DEFINITIONS
                if candidate.name == f"{name} Privileged Scaffold"
            )
            with self.subTest(scaffold=name):
                self.assertTrue(
                    molecule.HasSubstructMatch(Chem.MolFromSmarts(seed.smarts))
                )


class SmileitPatternAnnotationColorTests(SimpleTestCase):
    """Valida los colores de anotación usando las reglas reales del catálogo."""

    def test_nitroaromatic_molecule_gets_red_toxicophore_annotations(self) -> None:
        molecule = Chem.MolFromSmiles("O=[N+]([O-])c1ccccc1")
        annotations = collect_pattern_annotations(molecule, _seed_pattern_entries())

        red_annotations = [
            annotation
            for annotation in annotations
            if annotation["pattern_type"] == "toxicophore"
            and annotation["color"] == TOXICOPHORE_COLOR
        ]
        self.assertGreater(len(red_annotations), 0)
        for annotation in red_annotations:
            self.assertGreater(len(annotation["atom_indices"]), 0)

    def test_indole_molecule_gets_green_privileged_annotations(self) -> None:
        molecule = Chem.MolFromSmiles("c1ccc2[nH]ccc2c1")
        annotations = collect_pattern_annotations(molecule, _seed_pattern_entries())

        green_annotations = [
            annotation
            for annotation in annotations
            if annotation["pattern_type"] == "privileged"
            and annotation["color"] == PRIVILEGED_COLOR
        ]
        self.assertGreater(len(green_annotations), 0)
        self.assertIn(
            "Indole Privileged Scaffold",
            {annotation["name"] for annotation in green_annotations},
        )
        for annotation in green_annotations:
            self.assertGreater(len(annotation["atom_indices"]), 0)

    def test_privileged_rules_never_paint_red(self) -> None:
        molecule = Chem.MolFromSmiles("N1CCNCC1")
        annotations = collect_pattern_annotations(molecule, _seed_pattern_entries())
        self.assertGreater(len(annotations), 0)
        for annotation in annotations:
            if annotation["pattern_type"] == "privileged":
                self.assertEqual(annotation["color"], PRIVILEGED_COLOR)


class SmileitPatternSeedBootstrapMetadataTests(TestCase):
    """Valida la propagación de metadata de riesgo al persistir los seeds."""

    @classmethod
    def setUpTestData(cls) -> None:
        super().setUpTestData()
        SmileitPattern.objects.all().delete()
        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )

    def test_seed_patterns_persist_risk_category_and_source(self) -> None:
        for seed in PATTERN_SEED_DEFINITIONS:
            with self.subTest(rule=seed.name):
                pattern = SmileitPattern.objects.get(
                    name=seed.name,
                    pattern_type=seed.pattern_type,
                    version=1,
                )
                self.assertEqual(
                    pattern.provenance_metadata.get(RISK_CATEGORY_METADATA_KEY),
                    seed.risk_category,
                )
                self.assertTrue(pattern.provenance_metadata.get("seed"))
                self.assertEqual(pattern.source_reference, seed.source_reference)
                self.assertEqual(pattern.smarts, seed.smarts)

    def test_seed_patterns_are_active_and_latest(self) -> None:
        self.assertEqual(
            SmileitPattern.objects.filter(
                version=1, is_latest=True, is_active=True
            ).count(),
            len(PATTERN_SEED_DEFINITIONS),
        )

    def test_seed_patterns_are_visible_for_every_actor(self) -> None:
        self.assertEqual(len(list_active_patterns()), len(PATTERN_SEED_DEFINITIONS))
        self.assertEqual(
            len(list_active_patterns(actor_user_id=77, actor_role="user")),
            len(PATTERN_SEED_DEFINITIONS),
        )

    def test_seed_patterns_remain_protected_from_root_edits(self) -> None:
        pattern = SmileitPattern.objects.filter(version=1).first()
        assert pattern is not None
        payload = SmileitPatternCreatePayload(
            name=pattern.name,
            smarts=pattern.smarts,
            pattern_type=pattern.pattern_type,
            caption=pattern.caption,
            source_reference=pattern.source_reference,
            provenance_metadata={},
        )
        with self.assertRaises(PermissionError):
            update_pattern_entry(
                str(pattern.stable_id),
                payload,
                actor_user_id=1,
                actor_role="root",
            )
        with self.assertRaises(PermissionError):
            delete_pattern_entry(
                str(pattern.stable_id),
                actor_user_id=1,
                actor_role="root",
            )

    def test_deactivate_seed_data_keeps_traceability(self) -> None:
        deactivate_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            pattern_model=SmileitPattern,
        )
        self.assertEqual(
            SmileitPattern.objects.filter(is_active=True).count(),
            0,
        )
        self.assertEqual(
            SmileitPattern.objects.count(),
            len(PATTERN_SEED_DEFINITIONS),
        )

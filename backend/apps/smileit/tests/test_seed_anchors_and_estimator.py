"""test_seed_anchors_and_estimator.py: Cobertura del estimador y de las anclas semilla.

Objetivo del archivo:
- Fijar el contrato del estimador de derivados como cota de moléculas distintas.
- Verificar que el bootstrap de semillas remapea las anclas al SMILES canónico.
- Exercitar la migración de datos que corrige anclas obsoletas (idempotente).
- Verificar el aviso de sustituyentes que no pueden fusionarse en ningún sitio.
"""

from __future__ import annotations

import importlib
import uuid
from typing import Any

from django.apps import apps as django_apps
from django.test import TestCase

from ..definitions import MAX_DERIVATIVES_HARD_LIMIT
from ..engine import is_fusion_candidate_viable
from ..engine.builders import SiteOption, estimate_derivative_count
from ..models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)
from ..plugin import smileit_plugin
from ..seed_bootstrap import SUBSTITUENT_SOURCE_REFERENCE, apply_smileit_seed_data
from ..types import SmileitResolvedSubstituent

AROMATIC_SITES: list[int] = [0, 1, 2, 3, 4, 5]


def _make_option(site_atom_index: int, option_index: int) -> SiteOption:
    substituent = SmileitResolvedSubstituent(
        source_kind="manual",
        stable_id=f"sub-{option_index}",
        version=1,
        name=f"Sub{option_index}",
        smiles="[OH]",
        selected_atom_index=0,
        categories=[],
    )
    return SiteOption(
        site_atom_index=site_atom_index,
        block_label="BlockA",
        block_priority=1,
        substituent=substituent,
    )


def _build_site_option_map(
    site_count: int, options_per_site: int
) -> dict[int, list[SiteOption]]:
    return {
        site_atom_index: [
            _make_option(site_atom_index, option_index)
            for option_index in range(options_per_site)
        ]
        for site_atom_index in range(site_count)
    }


def _noop_progress(_percent: int, _stage: str, _message: str) -> None:
    pass


class EstimateDerivativeCountTests(TestCase):
    """El estimador cuenta moléculas distintas, no secuencias de fusión."""

    def test_four_sites_four_options_r4_counts_distinct_molecules(self) -> None:
        """Σ e_k para [4, 4, 4, 4] es 624 (sin factor k!).

        Nota: no se incluye el principal sin sustituir (e_0 = 1), que el
        estimador excluye porque r_substitutes arranca en 1.
        """
        site_option_map = _build_site_option_map(4, 4)

        self.assertEqual(
            estimate_derivative_count(site_option_map, r_substitutes=4), 624
        )

    def test_four_sites_three_options_r4_matches_real_job(self) -> None:
        """Σ_{k=1..4} C(4,k)·3^k = 255, el recuento real del job con 3 efectivos."""
        site_option_map = _build_site_option_map(4, 3)

        self.assertEqual(
            estimate_derivative_count(site_option_map, r_substitutes=4), 255
        )

    def test_r1_counts_only_single_site_assignments(self) -> None:
        """Con r=1 solo cuentan las asignaciones de un sitio (e_1)."""
        self.assertEqual(
            estimate_derivative_count(_build_site_option_map(4, 4), r_substitutes=1),
            16,
        )
        self.assertEqual(
            estimate_derivative_count(_build_site_option_map(4, 3), r_substitutes=1),
            12,
        )

    def test_sites_without_options_are_ignored(self) -> None:
        """Un sitio sin cobertura no aporta combinaciones al estimador."""
        site_option_map = _build_site_option_map(2, 2)
        site_option_map[99] = []

        self.assertEqual(estimate_derivative_count(site_option_map, r_substitutes=2), 8)

    def test_empty_map_estimates_zero(self) -> None:
        self.assertEqual(estimate_derivative_count({}, r_substitutes=3), 0)

    def test_hard_limit_still_truncates(self) -> None:
        """La estimación se recorta al tope duro para no calcular números enormes."""
        site_option_map = _build_site_option_map(20, 20)

        estimate = estimate_derivative_count(site_option_map, r_substitutes=20)

        self.assertEqual(estimate, MAX_DERIVATIVES_HARD_LIMIT + 1)
        self.assertGreater(estimate, MAX_DERIVATIVES_HARD_LIMIT)


class SeedBootstrapAnchorTests(TestCase):
    """El bootstrap guarda anclas en el espacio del SMILES canónico."""

    @classmethod
    def setUpTestData(cls) -> None:
        SmileitSubstituentCategory.objects.all().delete()
        SmileitSubstituent.objects.all().delete()
        SmileitPattern.objects.all().delete()
        SmileitCategory.objects.all().delete()
        super().setUpTestData()
        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )

    def _seed(self, name: str) -> SmileitSubstituent:
        return SmileitSubstituent.objects.get(name=name, version=1)

    def test_carboxylic_acid_anchor_remapped_to_carbonyl_carbon(self) -> None:
        """'C(=O)O' se canonicaliza a 'O=CO': el ancla 0 (C) pasa al índice 1."""
        substituent = self._seed("CarboxylicAcid")

        self.assertEqual(substituent.smiles_canonical, "O=CO")
        self.assertEqual(substituent.anchor_atom_indices, [1])

    def test_methoxy_and_methyl_ester_anchors_remapped(self) -> None:
        """El punto de unión deja de caer en el CH3 en ambas semillas."""
        self.assertEqual(self._seed("Methoxy").anchor_atom_indices, [1])
        self.assertEqual(self._seed("MethylEster").anchor_atom_indices, [2])

    def test_halomethanes_are_fusion_viable_on_aromatic_sites(self) -> None:
        """Dichloromethane/Difluoromethane/Trifluoromethane recuperan su ancla con H."""
        for name in ("Dichloromethane", "Difluoromethane", "Trifluoromethane"):
            with self.subTest(name=name):
                substituent = self._seed(name)
                self.assertTrue(
                    any(
                        is_fusion_candidate_viable(
                            "c1ccccc1",
                            substituent.smiles_canonical,
                            site,
                            substituent.anchor_atom_indices[0],
                            1,
                        )
                        for site in AROMATIC_SITES
                    ),
                    f"{name} debería poder fusionarse en algún sitio aromático.",
                )

    def test_remapped_seeds_are_fusion_viable(self) -> None:
        """CarboxylicAcid, Methoxy y MethylEster fusionan en sitios aromáticos."""
        for name in ("CarboxylicAcid", "Methoxy", "MethylEster"):
            with self.subTest(name=name):
                substituent = self._seed(name)
                self.assertTrue(
                    any(
                        is_fusion_candidate_viable(
                            "c1ccccc1",
                            substituent.smiles_canonical,
                            site,
                            substituent.anchor_atom_indices[0],
                            1,
                        )
                        for site in AROMATIC_SITES
                    ),
                    f"{name} debería poder fusionarse en algún sitio aromático.",
                )

    def test_applying_seed_data_twice_keeps_remapped_anchors(self) -> None:
        """Reaplicar el bootstrap no degrada las anclas ya remapeadas."""
        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )

        self.assertEqual(self._seed("CarboxylicAcid").anchor_atom_indices, [1])


class SeedAnchorMigrationTests(TestCase):
    """La migración de datos corrige filas semilla con anclas obsoletas."""

    def _migration_module(self) -> Any:
        return importlib.import_module(
            "apps.smileit.migrations.0003_fix_seed_substituent_anchors"
        )

    def _create_stale_seed(
        self, name: str, smiles_input: str, smiles_canonical: str, anchors: list[int]
    ) -> SmileitSubstituent:
        return SmileitSubstituent.objects.create(
            stable_id=uuid.uuid4(),
            version=1,
            is_latest=True,
            is_active=True,
            name=name,
            smiles_input=smiles_input,
            smiles_canonical=smiles_canonical,
            anchor_atom_indices=anchors,
            source_reference=SUBSTITUENT_SOURCE_REFERENCE,
            provenance_metadata={"seed": True},
        )

    def test_migration_remaps_stale_anchor_and_is_idempotent(self) -> None:
        """Una fila con ancla 0 obsoleta pasa a [1] y la segunda pasada no cambia."""
        stale = self._create_stale_seed("StaleCarboxylic", "C(=O)O", "O=CO", [0])
        migration = self._migration_module()

        migration.fix_seed_substituent_anchors(django_apps, None)
        stale.refresh_from_db()
        self.assertEqual(stale.anchor_atom_indices, [1])
        self.assertEqual(stale.smiles_canonical, "O=CO")

        migration.fix_seed_substituent_anchors(django_apps, None)
        stale.refresh_from_db()
        self.assertEqual(stale.anchor_atom_indices, [1])

    def test_migration_skips_unparseable_or_anchorless_rows(self) -> None:
        """Filas con SMILES inválido o sin anclas no rompen ni se tocan."""
        broken = self._create_stale_seed(
            "BrokenSeed", "no-es-smiles", "no-es-smiles", [0]
        )
        anchorless = self._create_stale_seed("AnchorlessSeed", "CCO", "CCO", [])

        self._migration_module().fix_seed_substituent_anchors(django_apps, None)

        broken.refresh_from_db()
        anchorless.refresh_from_db()
        self.assertEqual(broken.anchor_atom_indices, [0])
        self.assertEqual(anchorless.anchor_atom_indices, [])

    def test_migration_ignores_non_seed_substituents(self) -> None:
        """Solo se corrigen filas con la referencia del catálogo semilla."""
        custom = SmileitSubstituent.objects.create(
            stable_id=uuid.uuid4(),
            version=1,
            is_latest=True,
            is_active=True,
            name="CustomCarboxylic",
            smiles_input="C(=O)O",
            smiles_canonical="O=CO",
            anchor_atom_indices=[0],
            source_reference="user",
            provenance_metadata={},
        )

        self._migration_module().fix_seed_substituent_anchors(django_apps, None)

        custom.refresh_from_db()
        self.assertEqual(custom.anchor_atom_indices, [0])


class UnfusibleSubstituentWarningTests(TestCase):
    """El plugin avisa del sustituyente imposible sin romper el job."""

    def test_nitro_warns_and_job_keeps_generating(self) -> None:
        logs: list[tuple[str, str, str, object]] = []

        def _capture_log(
            level: str, source: str, message: str, payload: object
        ) -> None:
            logs.append((level, source, message, payload))

        result = smileit_plugin(
            {
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 2],
                "assignment_blocks": [
                    {
                        "label": "BlockA",
                        "priority": 1,
                        "site_atom_indices": [0, 2],
                        "resolved_substituents": [
                            {
                                "source_kind": "manual",
                                "stable_id": "nitro",
                                "version": 1,
                                "name": "Nitro",
                                "smiles": "O=[N+][O-]",
                                "selected_atom_index": 1,
                                "categories": [],
                            },
                            {
                                "source_kind": "manual",
                                "stable_id": "methoxy",
                                "version": 1,
                                "name": "Methoxy",
                                "smiles": "C[O]",
                                "selected_atom_index": 1,
                                "categories": [],
                            },
                        ],
                    }
                ],
                "r_substitutes": 1,
                "num_bonds": 1,
                "site_overlap_policy": "last_block_wins",
                "export_name_base": "SMILEIT",
                "export_padding": 5,
                "version": "2.0.1",
                "references": {},
            },
            _noop_progress,
            _capture_log,
        )

        warning_logs = [
            entry for entry in logs if entry[0] == "warning" and "Nitro" in entry[2]
        ]
        self.assertEqual(len(warning_logs), 1)
        self.assertEqual(warning_logs[0][1], "smileit.plugin")
        self.assertEqual(
            warning_logs[0][2],
            "El sustituyente 'Nitro' no puede fusionarse en ningún sitio "
            "seleccionado y no generará derivados.",
        )
        self.assertEqual(
            warning_logs[0][3],
            {"stable_id": "nitro", "version": 1, "name": "Nitro"},
        )
        self.assertGreater(result["total_generated"], 0)

    def test_warning_is_not_duplicated_for_repeated_anchors(self) -> None:
        """El mismo sustituyente repetido en varios bloques avisa una sola vez."""
        logs: list[tuple[str, str, str, object]] = []

        def _capture_log(
            level: str, source: str, message: str, payload: object
        ) -> None:
            logs.append((level, source, message, payload))

        nitro = {
            "source_kind": "manual",
            "stable_id": "nitro",
            "version": 1,
            "name": "Nitro",
            "smiles": "O=[N+][O-]",
            "selected_atom_index": 1,
            "categories": [],
        }
        smileit_plugin(
            {
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0],
                "assignment_blocks": [
                    {
                        "label": "BlockA",
                        "priority": 1,
                        "site_atom_indices": [0],
                        "resolved_substituents": [nitro],
                    },
                    {
                        "label": "BlockB",
                        "priority": 2,
                        "site_atom_indices": [0],
                        "resolved_substituents": [dict(nitro)],
                    },
                ],
                "r_substitutes": 1,
                "num_bonds": 1,
                "site_overlap_policy": "last_block_wins",
                "export_name_base": "SMILEIT",
                "export_padding": 5,
                "version": "2.0.1",
                "references": {},
            },
            _noop_progress,
            _capture_log,
        )

        nitro_warnings = [
            entry for entry in logs if entry[0] == "warning" and "Nitro" in entry[2]
        ]
        self.assertEqual(len(nitro_warnings), 1)

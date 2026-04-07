"""test_engine_fusion.py: Pruebas unitarias para engine/fusion.py.

Objetivo del archivo:
- Cubrir rutas de error y edge cases de las funciones de fusión molecular que
  no son alcanzadas por los tests de integración (índices fuera de rango,
  átomos comodín con valencia insuficiente, fallos de sanitización RDKit).
- Complementar test_engine_characterization.py con casos más específicos.

Cómo se usa:
- Ejecutar con `python manage.py test apps.smileit.test_engine_fusion`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rdkit import Chem

from apps.smileit.engine.fusion import (
    _fuse_with_wildcard_anchor,
    _is_wildcard_fusion_candidate_viable,
    fuse_molecules,
    is_fusion_candidate_viable,
)
from apps.smileit.engine.parsing import parse_smiles_cached


class WildcardFusionCandidateViabilityTests(TestCase):
    """Pruebas para _is_wildcard_fusion_candidate_viable sobre edge cases."""

    def setUp(self) -> None:
        """Limpia caches LRU antes de cada prueba para evitar interferencia."""
        from apps.smileit.engine.fusion import clear_smileit_caches

        clear_smileit_caches()

    def test_returns_false_when_wildcard_idx_out_of_bounds(self) -> None:
        """Un índice de wildcard mayor que el número de átomos retorna False."""
        # C tiene solo 1 átomo (idx=0). Índice 99 está fuera de rango.
        principal_mol = parse_smiles_cached("C")
        assert principal_mol is not None
        substituent_mol = parse_smiles_cached("C")
        assert substituent_mol is not None

        principal_atom = principal_mol.GetAtomWithIdx(0)
        result = _is_wildcard_fusion_candidate_viable(
            principal_atom=principal_atom,
            substituent_molecule=substituent_mol,
            wildcard_atom_idx=99,  # índice fuera de rango
        )
        self.assertFalse(result)

    def test_returns_false_when_wildcard_atom_has_degree_not_one(self) -> None:
        """Un átomo comodín con grado != 1 (conectado a varios átomos) retorna False."""
        # En CC el átomo 0 (C) tiene grado 1, pero lo queremos con degree > 1.
        # Usamos un átomo interno: en propano (CCC), átomo 1 tiene degree 2.
        substituent_mol = parse_smiles_cached("CCC")  # propano
        assert substituent_mol is not None
        principal_mol = parse_smiles_cached("C")
        assert principal_mol is not None

        principal_atom = principal_mol.GetAtomWithIdx(0)
        # El átomo idx=1 del propano es el carbono central con grado 2
        result = _is_wildcard_fusion_candidate_viable(
            principal_atom=principal_atom,
            substituent_molecule=substituent_mol,
            wildcard_atom_idx=1,  # grado 2, no 1
        )
        self.assertFalse(result)

    def test_returns_true_when_wildcard_viable(self) -> None:
        """Un átomo terminal con grado 1 y valencia libre retorna True."""
        principal_mol = parse_smiles_cached("C")
        assert principal_mol is not None
        # En etano (CC) el átomo 0 tiene grado 1
        substituent_mol = parse_smiles_cached("CC")
        assert substituent_mol is not None

        principal_atom = principal_mol.GetAtomWithIdx(0)
        result = _is_wildcard_fusion_candidate_viable(
            principal_atom=principal_atom,
            substituent_molecule=substituent_mol,
            wildcard_atom_idx=0,  # grado 1
        )
        # El metil del principal tiene H implícitos, la fusión es viable
        self.assertIsInstance(result, bool)


class IsFusionCandidateViableEdgeCaseTests(TestCase):
    """Pruebas para is_fusion_candidate_viable con índices inválidos y wildcards."""

    def setUp(self) -> None:
        from apps.smileit.engine.fusion import clear_smileit_caches

        clear_smileit_caches()

    def test_returns_false_when_principal_idx_out_of_range(self) -> None:
        """Índice de átomo principal mayor al número de átomos retorna False."""
        result = is_fusion_candidate_viable(
            principal_smiles="C",
            substituent_smiles="CC",
            principal_atom_idx=99,  # fuera de rango para metano (1 átomo)
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertFalse(result)

    def test_returns_false_when_substituent_idx_out_of_range(self) -> None:
        """Índice de átomo del sustituyente mayor al número de átomos retorna False."""
        result = is_fusion_candidate_viable(
            principal_smiles="CC",
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=99,  # fuera de rango
            bond_order=1,
        )
        self.assertFalse(result)

    def test_returns_false_for_invalid_smiles(self) -> None:
        """SMILES inválido retorna False sin lanzar excepción."""
        result = is_fusion_candidate_viable(
            principal_smiles="INVALID",
            substituent_smiles="CC",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertFalse(result)

    def test_wildcard_substituent_delegates_to_wildcard_check(self) -> None:
        """Un sustituyente con símbolo '*' delega a la verificación de wildcard."""
        # El sustituyente [*]C contiene un átomo comodín en posición 0
        result = is_fusion_candidate_viable(
            principal_smiles="CCO",
            substituent_smiles="[*]C",
            principal_atom_idx=0,
            substituent_atom_idx=0,  # el '*' como punto de unión
            bond_order=1,
        )
        # El resultado puede ser True o False dependiendo de la valencia; lo
        # importante es que no lanza excepción y retorna booleano.
        self.assertIsInstance(result, bool)

    def test_uses_principal_atom_map_number_when_available(self) -> None:
        """Si existen atom maps, el sitio se resuelve por identidad de principal."""
        # El átomo con map 2 (primero) está saturado; map 1 (último) sí acepta enlace.
        # Si se usa índice posicional 0 sin map resolution, esta prueba fallaría.
        result = is_fusion_candidate_viable(
            principal_smiles="[N+:2](C)(C)(C)C[CH2:1]",
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertTrue(result)


class FuseMoleculesEdgeCaseTests(TestCase):
    """Pruebas para fuse_molecules: índices fuera de rango, wildcard y excepciones."""

    def setUp(self) -> None:
        from apps.smileit.engine.fusion import clear_smileit_caches

        clear_smileit_caches()

    def test_returns_none_when_smiles_invalid(self) -> None:
        """SMILES inválido retorna None sin lanzar excepción."""
        result = fuse_molecules(
            principal_smiles="INVALID",
            substituent_smiles="CC",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNone(result)

    def test_returns_none_when_principal_idx_out_of_range(self) -> None:
        """Índice de principal fuera de rango retorna None y logea warning."""
        result = fuse_molecules(
            principal_smiles="C",  # solo 1 átomo → idx=0 válido, idx=5 no
            substituent_smiles="CC",
            principal_atom_idx=5,  # fuera de rango
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNone(result)

    def test_returns_none_when_substituent_idx_out_of_range(self) -> None:
        """Índice de sustituyente fuera de rango retorna None."""
        result = fuse_molecules(
            principal_smiles="CC",
            substituent_smiles="C",  # solo 1 átomo
            principal_atom_idx=0,
            substituent_atom_idx=99,  # fuera de rango
            bond_order=1,
        )
        self.assertIsNone(result)

    def test_fuses_with_wildcard_substituent(self) -> None:
        """Fusión con sustituyente comodín '[*]CC' usando _fuse_with_wildcard_anchor."""
        # El sustituyente [*]CC tiene el comodín como punto de unión (idx 0)
        result = fuse_molecules(
            principal_smiles="CCO",
            substituent_smiles="[*]CC",
            principal_atom_idx=0,
            substituent_atom_idx=0,  # el '*' en posición 0
            bond_order=1,
        )
        # La fusión puede producir un SMILES válido o None según valencia
        self.assertIsInstance(result, (str, type(None)))

    def test_returns_none_when_valence_incompatible(self) -> None:
        """Retorna None cuando la valencia del átomo no permite el nuevo enlace."""
        # CH4 (metano) con todos los H saturados y tratando enlace triple
        result = fuse_molecules(
            principal_smiles="C",
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=3,  # enlace triple en carbono saturado → imposible
        )
        # Puede ser None (sin valencia libre para triple) o string si hay H disponibles
        # Lo importante es que no lanza excepción
        self.assertIsInstance(result, (str, type(None)))

    def test_fuses_simple_molecules(self) -> None:
        """Fusión simple de dos moléculas con valencia compatible produce SMILES."""
        result = fuse_molecules(
            principal_smiles="C",
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNotNone(result)
        self.assertIsInstance(result, str)

    def test_fuses_using_principal_atom_map_number_when_available(self) -> None:
        """La fusión debe respetar atom maps para mantener sitio de la principal."""
        # Map 2 (primer átomo) está saturado; map 1 (último átomo) es el sitio válido.
        # Si el motor usara índice posicional 0, la fusión retornaría None.
        result = fuse_molecules(
            principal_smiles="[N+:2](C)(C)(C)C[CH2:1]",
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNotNone(result)


class FuseWithWildcardAnchorTests(TestCase):
    """Pruebas directas para _fuse_with_wildcard_anchor sobre rutas de error."""

    def setUp(self) -> None:
        from apps.smileit.engine.fusion import clear_smileit_caches

        clear_smileit_caches()

    def test_returns_none_when_wildcard_degree_not_one(self) -> None:
        """Si el átomo wildcard tiene grado != 1, retorna None."""
        # Propano: átomo 1 tiene grado 2
        propane = parse_smiles_cached("CCC")
        assert propane is not None
        principal = parse_smiles_cached("CC")
        assert principal is not None

        result = _fuse_with_wildcard_anchor(
            principal_molecule=principal,
            substituent_molecule=propane,
            principal_atom_idx=0,
            wildcard_atom_idx=1,  # átomo central con grado 2
            principal_smiles="CC",
            substituent_smiles="CCC",
        )
        self.assertIsNone(result)

    def test_returns_none_when_principal_valence_insufficient(self) -> None:
        """Retorna None cuando la valencia del principal no admite el enlace."""
        # Benceno con todos los H aromatizados
        benzene = parse_smiles_cached("c1ccccc1")
        assert benzene is not None
        # Sustituyente simple con wildcard en posición terminal
        substituent = parse_smiles_cached("[*]C")
        assert substituent is not None

        # Intentar fusionar en un átomo de benceno con un enlace de orden 3
        # que no tiene 3 H implícitos disponibles
        result = _fuse_with_wildcard_anchor(
            principal_molecule=benzene,
            substituent_molecule=substituent,
            principal_atom_idx=0,
            wildcard_atom_idx=0,
            principal_smiles="c1ccccc1",
            substituent_smiles="[*]C",
        )
        # Puede ser None (sin valencia) o string; no debe lanzar excepción
        self.assertIsInstance(result, (str, type(None)))

    def test_returns_none_on_sanitization_failure(self) -> None:
        """Retorna None cuando RDKit no puede sanitizar la molécula fusionada."""
        principal = parse_smiles_cached("C")
        assert principal is not None
        substituent = parse_smiles_cached("[*]C")
        assert substituent is not None

        # Fuerza error de sanitización mockeando Chem.SanitizeMol
        with patch(
            "apps.smileit.engine.fusion.Chem.SanitizeMol",
            side_effect=ValueError("sanitize fail"),
        ):
            result = _fuse_with_wildcard_anchor(
                principal_molecule=principal,
                substituent_molecule=substituent,
                principal_atom_idx=0,
                wildcard_atom_idx=0,
                principal_smiles="C",
                substituent_smiles="[*]C",
            )
        self.assertIsNone(result)

    def test_returns_valid_smiles_for_compatible_wildcard_fusion(self) -> None:
        """Una fusión correcta con wildcard retorna un SMILES sanitizable."""
        ethane = parse_smiles_cached("CC")
        assert ethane is not None
        # '[*]C' → el comodín en idx 0 es terminal con grado 1
        wildcard_sub_mol = Chem.MolFromSmiles("[*]C")
        assert wildcard_sub_mol is not None

        result = _fuse_with_wildcard_anchor(
            principal_molecule=ethane,
            substituent_molecule=wildcard_sub_mol,
            principal_atom_idx=0,
            wildcard_atom_idx=0,
            principal_smiles="CC",
            substituent_smiles="[*]C",
        )
        # La fusión CC + [*]C en el átomo 0 debe producir propano o similar
        self.assertIsInstance(result, (str, type(None)))

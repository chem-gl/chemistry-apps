"""test_physics_unit.py: Tests unitarios para _tst_physics.py.

Objetivo: Cubrir rutas de error y casos borde en las funciones de física
cinética (viscosidad, túnel, difusión) que no son alcanzadas por los
tests de integración HTTP existentes.
"""

from __future__ import annotations

import math
from unittest import TestCase
from unittest.mock import MagicMock, patch

from ._tst_physics import (
    _compute_diffusion_terms,
    _compute_thermodynamic_terms,
    _compute_tunnel_terms,
    _resolve_viscosity,
)

# =========================
# HELPERS
# =========================


def _make_snapshot(
    *,
    temperature: float = 298.15,
    thermal_enthalpy: float = -99.9,
    free_energy: float = -100.0,
    zero_point_energy: float = -99.85,
    imaginary_frequency: float = 0.0,
    negative_frequencies: int = 0,
    is_provided: bool = True,
) -> dict:
    """Crea un snapshot mínimo para pruebas de termodinámica."""
    return {
        "source_field": "test",
        "original_filename": None,
        "is_provided": is_provided,
        "execution_index": 0,
        "available_execution_count": 1,
        "job_title": None,
        "checkpoint_file": None,
        "charge": 0,
        "multiplicity": 1,
        "free_energy": free_energy,
        "thermal_enthalpy": thermal_enthalpy,
        "zero_point_energy": zero_point_energy,
        "scf_energy": -100.2,
        "temperature": temperature,
        "negative_frequencies": negative_frequencies,
        "imaginary_frequency": imaginary_frequency,
        "normal_termination": True,
        "is_opt_freq": True,
    }


def _make_structures(
    *,
    ts_temperature: float = 298.15,
    ts_imaginary: float = 625.0,
) -> dict:
    """Crea diccionario completo de estructuras para pruebas de termodinámica."""
    reactant = _make_snapshot(temperature=ts_temperature)
    product = _make_snapshot(
        temperature=ts_temperature, thermal_enthalpy=-110.0, free_energy=-110.5
    )
    ts = _make_snapshot(
        temperature=ts_temperature,
        thermal_enthalpy=-180.0,
        free_energy=-181.0,
        imaginary_frequency=ts_imaginary,
    )
    return {
        "reactant_1_file": reactant,
        "reactant_2_file": reactant,
        "transition_state_file": ts,
        "product_1_file": product,
        "product_2_file": product,
    }


# =========================
# _resolve_viscosity
# =========================


class ResolveViscosityTests(TestCase):
    """Prueba los distintos caminos de resolución de viscosidad."""

    def test_other_with_none_custom_raises(self) -> None:
        """Solvent='Other' sin custom_viscosity debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _resolve_viscosity(solvent="Other", custom_viscosity=None)

    def test_other_with_zero_custom_raises(self) -> None:
        """Solvent='Other' con custom_viscosity <= 0 debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _resolve_viscosity(solvent="Other", custom_viscosity=0.0)

    def test_other_with_negative_custom_raises(self) -> None:
        """Solvent='Other' con custom_viscosity negativa debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _resolve_viscosity(solvent="Other", custom_viscosity=-0.001)

    def test_other_with_valid_custom_returns_it(self) -> None:
        """Solvent='Other' con custom_viscosity > 0 retorna ese valor."""
        result = _resolve_viscosity(solvent="Other", custom_viscosity=0.005)
        self.assertAlmostEqual(result, 0.005)

    def test_empty_solvent_returns_none(self) -> None:
        """Solvent vacío retorna None (sin viscosidad conocida)."""
        result = _resolve_viscosity(solvent="", custom_viscosity=None)
        self.assertIsNone(result)

    def test_unknown_solvent_returns_none(self) -> None:
        """Solvente desconocido no en el mapa retorna None."""
        result = _resolve_viscosity(solvent="SomeExoticSolvent", custom_viscosity=None)
        self.assertIsNone(result)

    def test_known_solvent_returns_value(self) -> None:
        """Solvente conocido (Benzene) retorna la viscosidad del mapa."""
        result = _resolve_viscosity(solvent="Benzene", custom_viscosity=None)
        self.assertIsNotNone(result)
        self.assertGreater(result, 0.0)


# =========================
# _compute_thermodynamic_terms
# =========================


class ComputeThermodynamicTermsTests(TestCase):
    """Prueba casos borde en la función de términos termodinámicos."""

    def _make_emit_log(self) -> MagicMock:
        """Crea un mock de emit_log para inyectar en las pruebas."""
        return MagicMock()

    def test_zero_temperature_raises(self) -> None:
        """Temperatura cero debe lanzar ValueError antes de cualquier cálculo."""
        structures = _make_structures(ts_temperature=0.0)
        with self.assertRaises(ValueError):
            _compute_thermodynamic_terms(
                structures=structures,
                cage_effects=False,
                emit_log=self._make_emit_log(),
            )

    def test_negative_temperature_raises(self) -> None:
        """Temperatura negativa debe lanzar ValueError."""
        structures = _make_structures(ts_temperature=-10.0)
        with self.assertRaises(ValueError):
            _compute_thermodynamic_terms(
                structures=structures,
                cage_effects=False,
                emit_log=self._make_emit_log(),
            )

    def test_valid_computation_returns_dict(self) -> None:
        """Cálculo válido retorna diccionario con los campos esperados."""
        structures = _make_structures()
        result = _compute_thermodynamic_terms(
            structures=structures,
            cage_effects=False,
            emit_log=self._make_emit_log(),
        )
        self.assertIn("temperature_k", result)
        self.assertIn("gibbs_activation", result)
        self.assertIn("delta_n_transition", result)

    def test_cage_effects_with_two_reactants_applies_correction(self) -> None:
        """Corrección cage se aplica cuando delta_n_transition != 0."""
        structures = _make_structures()
        mock_log = self._make_emit_log()
        result = _compute_thermodynamic_terms(
            structures=structures,
            cage_effects=True,
            emit_log=mock_log,
        )
        # Con 2 reactivos, delta_n_transition = 1 - 2 = -1 ≠ 0.
        # La corrección cage se aplica y el log es llamado.
        self.assertNotEqual(result["delta_n_transition"], 0)
        mock_log.assert_called()


# =========================
# _compute_tunnel_terms
# =========================


class ComputeTunnelTermsTests(TestCase):
    """Prueba las rutas de retorno temprano y error en el cálculo de túnel."""

    def test_non_finite_frequency_raises(self) -> None:
        """Frecuencia imaginaria no finita debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_tunnel_terms(
                gibbs_activation=5.0,
                zpe_activation=2.0,
                zpe_reaction=1.0,
                imaginary_frequency=math.inf,
                temperature_k=298.15,
            )

    def test_zero_frequency_raises(self) -> None:
        """Frecuencia imaginaria de cero debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_tunnel_terms(
                gibbs_activation=5.0,
                zpe_activation=2.0,
                zpe_reaction=1.0,
                imaginary_frequency=0.0,
                temperature_k=298.15,
            )

    def test_negative_frequency_raises(self) -> None:
        """Frecuencia imaginaria negativa debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_tunnel_terms(
                gibbs_activation=5.0,
                zpe_activation=2.0,
                zpe_reaction=1.0,
                imaginary_frequency=-300.0,
                temperature_k=298.15,
            )

    def test_negative_gibbs_activation_returns_early_with_warn(self) -> None:
        """Gibbs activación negativa retorna warn_negative_activation=True sin calcular."""
        result = _compute_tunnel_terms(
            gibbs_activation=-1.0,
            zpe_activation=2.0,
            zpe_reaction=1.0,
            imaginary_frequency=300.0,
            temperature_k=298.15,
        )
        self.assertTrue(result["warn_negative_activation"])
        self.assertIsNone(result["tunnel_u"])
        self.assertIsNone(result["tunnel_g"])
        self.assertEqual(result["kappa_tst"], 1.0)

    def test_zero_gibbs_activation_returns_early_with_warn(self) -> None:
        """Gibbs activación = 0 también dispara retorno anticipado."""
        result = _compute_tunnel_terms(
            gibbs_activation=0.0,
            zpe_activation=2.0,
            zpe_reaction=1.0,
            imaginary_frequency=300.0,
            temperature_k=298.15,
        )
        self.assertTrue(result["warn_negative_activation"])

    def test_non_positive_zpe_activation_returns_partial_result(self) -> None:
        """ZPE activación negativa retorna cálculo parcial con alpha_1=None."""
        result = _compute_tunnel_terms(
            gibbs_activation=5.0,
            zpe_activation=-1.0,
            zpe_reaction=1.0,
            imaginary_frequency=300.0,
            temperature_k=298.15,
        )
        self.assertFalse(result["warn_negative_activation"])
        self.assertIsNotNone(result["tunnel_u"])
        self.assertIsNone(result["tunnel_alpha_1"])
        self.assertIsNone(result["tunnel_alpha_2"])
        self.assertEqual(result["kappa_tst"], 1.0)

    def test_zero_zpe_activation_returns_partial(self) -> None:
        """ZPE activación = 0.0 también produce resultado parcial."""
        result = _compute_tunnel_terms(
            gibbs_activation=5.0,
            zpe_activation=0.0,
            zpe_reaction=0.5,
            imaginary_frequency=300.0,
            temperature_k=298.15,
        )
        self.assertFalse(result["warn_negative_activation"])
        self.assertIsNone(result["tunnel_alpha_1"])

    def test_zpe_activation_le_zpe_reaction_raises(self) -> None:
        """ZPE activación <= ZPE reacción debe lanzar ValueError de entrada."""
        with self.assertRaises(ValueError):
            _compute_tunnel_terms(
                gibbs_activation=5.0,
                zpe_activation=2.0,
                zpe_reaction=3.0,
                imaginary_frequency=300.0,
                temperature_k=298.15,
            )

    def test_zpe_activation_equal_zpe_reaction_raises(self) -> None:
        """ZPE activación == ZPE reacción también lanza ValueError."""
        with self.assertRaises(ValueError):
            _compute_tunnel_terms(
                gibbs_activation=5.0,
                zpe_activation=2.0,
                zpe_reaction=2.0,
                imaginary_frequency=300.0,
                temperature_k=298.15,
            )

    def test_tst_failure_with_error_message_raises_that_message(self) -> None:
        """Cuando TST falla con mensaje, lanza ValueError con ese mensaje."""
        mock_result = MagicMock()
        mock_result.success = False
        mock_result.error_message = "TST no convergió en iteración 10."
        with patch("apps.easy_rate._tst_physics.TST") as mock_tst_class:
            mock_tst_class.return_value.set_parameters.return_value = mock_result
            with self.assertRaises(ValueError) as ctx:
                _compute_tunnel_terms(
                    gibbs_activation=5.0,
                    zpe_activation=3.0,
                    zpe_reaction=1.0,
                    imaginary_frequency=300.0,
                    temperature_k=298.15,
                )
            self.assertIn("TST no convergió", str(ctx.exception))

    def test_tst_failure_with_none_message_raises_generic(self) -> None:
        """Cuando TST falla sin mensaje, lanza ValueError genérico."""
        mock_result = MagicMock()
        mock_result.success = False
        mock_result.error_message = None
        with patch("apps.easy_rate._tst_physics.TST") as mock_tst_class:
            mock_tst_class.return_value.set_parameters.return_value = mock_result
            with self.assertRaises(ValueError) as ctx:
                _compute_tunnel_terms(
                    gibbs_activation=5.0,
                    zpe_activation=3.0,
                    zpe_reaction=1.0,
                    imaginary_frequency=300.0,
                    temperature_k=298.15,
                )
            self.assertIn("Error desconocido", str(ctx.exception))


# =========================
# _compute_diffusion_terms
# =========================


class ComputeDiffusionTermsTests(TestCase):
    """Prueba el cálculo de corrección difusiva con sus validaciones."""

    def _valid_args(self, **overrides: object) -> dict:
        """Construye argumentos válidos para _compute_diffusion_terms."""
        base: dict[str, object] = {
            "diffusion_enabled": True,
            "solvent": "Water",
            "custom_viscosity": None,
            "radius_reactant_1": 2.0,
            "radius_reactant_2": 2.0,
            "reaction_distance": 3.0,
            "temperature_k": 298.15,
            "rate_constant_tst": 1.0e8,
        }
        base.update(overrides)
        return base

    def test_diffusion_disabled_returns_early_without_computation(self) -> None:
        """Cuando diffusion=False, retorna sin calcular k_diff ni viscosidad."""
        result = _compute_diffusion_terms(**self._valid_args(diffusion_enabled=False))
        self.assertIsNone(result["k_diff"])
        self.assertIsNone(result["viscosity_pa_s"])
        self.assertEqual(result["final_rate_constant"], 1.0e8)

    def test_unknown_solvent_raises_no_valid_viscosity(self) -> None:
        """Solvente desconocido con diffusion=True lanza ValueError de viscosidad."""
        with self.assertRaises(ValueError) as ctx:
            _compute_diffusion_terms(**self._valid_args(solvent="SolventeInexistente"))
        self.assertIn("viscosidad", str(ctx.exception))

    def test_none_radius_r1_raises(self) -> None:
        """Radio reactante 1 = None debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_diffusion_terms(**self._valid_args(radius_reactant_1=None))

    def test_zero_radius_r1_raises(self) -> None:
        """Radio reactante 1 = 0 debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_diffusion_terms(**self._valid_args(radius_reactant_1=0.0))

    def test_none_radius_r2_raises(self) -> None:
        """Radio reactante 2 = None debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_diffusion_terms(**self._valid_args(radius_reactant_2=None))

    def test_none_reaction_distance_raises(self) -> None:
        """Distancia de reacción = None debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_diffusion_terms(**self._valid_args(reaction_distance=None))

    def test_zero_reaction_distance_raises(self) -> None:
        """Distancia de reacción = 0 debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _compute_diffusion_terms(**self._valid_args(reaction_distance=0.0))

    def test_none_rate_constant_gives_no_diffusion_correction(self) -> None:
        """Cuando rate_constant_tst=None, k_diff es calculado pero corrección es None."""
        result = _compute_diffusion_terms(**self._valid_args(rate_constant_tst=None))
        self.assertIsNotNone(result["k_diff"])
        self.assertIsNone(result["rate_constant_diffusion_corrected"])
        self.assertIsNone(result["final_rate_constant"])

    def test_valid_diffusion_computation_returns_all_fields(self) -> None:
        """Cálculo de difusión válido retorna todos los campos numéricos."""
        result = _compute_diffusion_terms(**self._valid_args())
        self.assertIsNotNone(result["viscosity_pa_s"])
        self.assertIsNotNone(result["k_diff"])
        self.assertIsNotNone(result["rate_constant_diffusion_corrected"])
        self.assertIsNotNone(result["final_rate_constant"])

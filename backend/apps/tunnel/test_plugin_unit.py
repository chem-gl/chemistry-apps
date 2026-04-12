"""test_plugin_unit.py: Tests unitarios para funciones internas de plugin.py del tunnel.

Objetivo: Cubrir rutas de validación de parámetros de entrada y manejo de errores
del cálculo CK_TEST que no son alcanzadas por los tests de integración HTTP existentes.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock, patch

from apps.tunnel.plugin import _build_input_change_event, _build_tunnel_input
from apps.tunnel.types import TunnelInputChangeEvent

# =========================
# _build_input_change_event
# =========================


class BuildInputChangeEventTests(TestCase):
    """Prueba las validaciones en _build_input_change_event."""

    def _call(self, raw_event: dict) -> TunnelInputChangeEvent:

        return _build_input_change_event(raw_event)

    def test_empty_field_name_raises_value_error(self) -> None:
        """Un evento sin field_name (cadena vacía) debe lanzar ValueError."""
        with self.assertRaises(ValueError, msg="Cada evento debe incluir field_name."):
            self._call({"field_name": "", "changed_at": "2024-01-01T00:00:00Z"})

    def test_whitespace_only_field_name_raises_value_error(self) -> None:
        """field_name con solo espacios debe lanzar ValueError al hacer strip."""
        with self.assertRaises(ValueError):
            self._call({"field_name": "   ", "changed_at": "2024-01-01T00:00:00Z"})

    def test_empty_changed_at_raises_value_error(self) -> None:
        """Un evento sin changed_at (cadena vacía) debe lanzar ValueError."""
        with self.assertRaises(ValueError, msg="Cada evento debe incluir changed_at."):
            self._call({"field_name": "temperature", "changed_at": ""})

    def test_whitespace_only_changed_at_raises_value_error(self) -> None:
        """changed_at con solo espacios debe lanzar ValueError al hacer strip."""
        with self.assertRaises(ValueError):
            self._call({"field_name": "temperature", "changed_at": "  "})

    def test_valid_event_returns_typed_dict(self) -> None:
        """Evento válido debe retornar el TypedDict con valores correctos."""
        result = self._call(
            {
                "field_name": "temperature",
                "changed_at": "2024-01-01T10:00:00Z",
                "previous_value": 298.15,
                "new_value": 310.0,
            }
        )
        self.assertEqual(result["field_name"], "temperature")  # type: ignore[index]
        self.assertAlmostEqual(result["previous_value"], 298.15)  # type: ignore[index]
        self.assertAlmostEqual(result["new_value"], 310.0)  # type: ignore[index]


# =========================
# _build_tunnel_input
# =========================


class BuildTunnelInputTests(TestCase):
    """Prueba las validaciones de dominio en _build_tunnel_input."""

    _VALID_BASE: dict = {
        "reaction_barrier_zpe": 3.5,
        "imaginary_frequency": 625.0,
        "reaction_energy_zpe": -8.2,
        "temperature": 298.15,
        "input_change_events": [],
    }

    def _call(self, params: dict) -> TunnelInputChangeEvent:

        return _build_tunnel_input(params)

    def test_zero_barrier_zpe_raises_value_error(self) -> None:
        """reaction_barrier_zpe = 0 debe lanzar ValueError (debe ser > 0)."""
        params = {**self._VALID_BASE, "reaction_barrier_zpe": 0.0}
        with self.assertRaises(
            ValueError, msg="reaction_barrier_zpe debe ser mayor que cero."
        ):
            self._call(params)

    def test_negative_barrier_zpe_raises_value_error(self) -> None:
        """reaction_barrier_zpe negativo debe lanzar ValueError."""
        params = {**self._VALID_BASE, "reaction_barrier_zpe": -1.0}
        with self.assertRaises(ValueError):
            self._call(params)

    def test_zero_imaginary_frequency_raises_value_error(self) -> None:
        """imaginary_frequency = 0 debe lanzar ValueError."""
        params = {**self._VALID_BASE, "imaginary_frequency": 0.0}
        with self.assertRaises(
            ValueError, msg="imaginary_frequency debe ser mayor que cero."
        ):
            self._call(params)

    def test_negative_imaginary_frequency_raises_value_error(self) -> None:
        """imaginary_frequency negativa debe lanzar ValueError."""
        params = {**self._VALID_BASE, "imaginary_frequency": -100.0}
        with self.assertRaises(ValueError):
            self._call(params)

    def test_zero_temperature_raises_value_error(self) -> None:
        """temperature = 0 debe lanzar ValueError."""
        params = {**self._VALID_BASE, "temperature": 0.0}
        with self.assertRaises(ValueError, msg="temperature debe ser mayor que cero."):
            self._call(params)

    def test_negative_temperature_raises_value_error(self) -> None:
        """temperature negativa debe lanzar ValueError."""
        params = {**self._VALID_BASE, "temperature": -50.0}
        with self.assertRaises(ValueError):
            self._call(params)

    def test_events_not_a_list_raises_value_error(self) -> None:
        """input_change_events que no sea lista debe lanzar ValueError."""
        params = {**self._VALID_BASE, "input_change_events": {"key": "val"}}
        with self.assertRaises(
            ValueError, msg="input_change_events debe ser una lista de eventos."
        ):
            self._call(params)

    def test_event_not_a_dict_raises_value_error(self) -> None:
        """Elemento de input_change_events que no sea dict debe lanzar ValueError."""
        params = {**self._VALID_BASE, "input_change_events": ["not_a_dict"]}
        with self.assertRaises(
            ValueError, msg="Cada evento de input_change_events debe ser un objeto."
        ):
            self._call(params)

    def test_valid_parameters_return_typed_dict(self) -> None:
        """Parámetros válidos deben retornar el TypedDict de entrada normalizado."""
        result = self._call(self._VALID_BASE)
        self.assertAlmostEqual(result["reaction_barrier_zpe"], 3.5)  # type: ignore[index]
        self.assertAlmostEqual(result["temperature"], 298.15)  # type: ignore[index]
        self.assertEqual(result["input_change_events"], [])  # type: ignore[index]


# =========================
# tunnel_effect_plugin error paths
# =========================


class TunnelEffectPluginErrorTests(TestCase):
    """Prueba rutas de error en tunnel_effect_plugin que requieren mock del TST."""

    _VALID_PARAMS: dict = {
        "reaction_barrier_zpe": 3.5,
        "imaginary_frequency": 625.0,
        "reaction_energy_zpe": -8.2,
        "temperature": 298.15,
        "input_change_events": [],
    }

    def _call_plugin(self, params: dict) -> None:
        from .plugin import tunnel_effect_plugin

        progress_callback = MagicMock()
        tunnel_effect_plugin(
            parameters=params,
            progress_callback=progress_callback,
        )

    def _build_failing_calc_result(self, error_message: str | None = None) -> MagicMock:
        """Construye un resultado de cálculo fallido."""
        mock_result = MagicMock()
        mock_result.success = False
        mock_result.error_message = error_message
        return mock_result

    def _build_non_finite_calc_result(self) -> MagicMock:
        """Construye un resultado con valores no finitos (NaN)."""
        import math

        mock_result = MagicMock()
        mock_result.success = True
        mock_result.u = math.nan
        mock_result.alpha_1 = 0.5
        mock_result.alpha_2 = 0.5
        mock_result.g = 1.0
        return mock_result

    def test_calc_failure_with_message_raises_value_error(self) -> None:
        """Fallo en TST con mensaje de error → ValueError con el mensaje."""
        with patch("apps.tunnel.plugin.TST") as mock_tst_cls:
            mock_tst = MagicMock()
            mock_tst.set_parameters.return_value = self._build_failing_calc_result(
                "Error interno del cálculo"
            )
            mock_tst_cls.return_value = mock_tst
            with self.assertRaises(ValueError) as ctx:
                self._call_plugin(self._VALID_PARAMS)
        self.assertIn("Error interno del cálculo", str(ctx.exception))

    def test_calc_failure_without_message_raises_default_error(self) -> None:
        """Fallo en TST sin mensaje → ValueError con mensaje por defecto."""
        with patch("apps.tunnel.plugin.TST") as mock_tst_cls:
            mock_tst = MagicMock()
            mock_tst.set_parameters.return_value = self._build_failing_calc_result(
                error_message=None
            )
            mock_tst_cls.return_value = mock_tst
            with self.assertRaises(ValueError) as ctx:
                self._call_plugin(self._VALID_PARAMS)
        self.assertIn("Error desconocido", str(ctx.exception))

    def test_non_finite_values_raises_value_error(self) -> None:
        """Valores no finitos en resultado TST → ValueError con mensaje apropiado."""
        with patch("apps.tunnel.plugin.TST") as mock_tst_cls:
            mock_tst = MagicMock()
            mock_tst.set_parameters.return_value = self._build_non_finite_calc_result()
            mock_tst_cls.return_value = mock_tst
            with self.assertRaises(ValueError) as ctx:
                self._call_plugin(self._VALID_PARAMS)
        self.assertIn("no finitos", str(ctx.exception))

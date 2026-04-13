"""test_gaussian_unit.py: Tests unitarios para inspection/gaussian.py.

Objetivo: Cubrir rutas de validación y normalización en el inspector Gaussian
que no son alcanzadas por los tests de integración HTTP existentes.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock

from .inspection.gaussian import (
    _build_structure_snapshot,
    _collect_structure_validation_errors,
    _parse_gaussian_execution,
    _to_optional_finite,
    _validate_structure_snapshot,
)
from .types import EasyRateStructureSnapshot

# =========================
# HELPERS
# =========================


def _make_mock_execution(
    *,
    imaginary_frequency: float = 0.0,
    negative_frequencies: int = 0,
    free_energies: float = -100.0,
    thermal_enthalpies: float = -99.9,
    zero_point_energy: float = -99.85,
    scf_energy: float = -100.2,
    temperature: float = 298.15,
    charge: int = 0,
    multiplicity: int = 1,
    normal_termination: bool = True,
    is_opt_freq: bool = True,
    job_title: str = "Test Job",
    checkpoint_file: str = "",
) -> MagicMock:
    """Crea un mock de GaussianExecution con los atributos necesarios."""
    mock_exec = MagicMock()
    mock_exec.imaginary_frequency = imaginary_frequency
    mock_exec.negative_frequencies = negative_frequencies
    mock_exec.free_energies = free_energies
    mock_exec.thermal_enthalpies = thermal_enthalpies
    mock_exec.zero_point_energy = zero_point_energy
    mock_exec.scf_energy = scf_energy
    mock_exec.temperature = temperature
    mock_exec.charge = charge
    mock_exec.multiplicity = multiplicity
    mock_exec.normal_termination = normal_termination
    mock_exec.is_opt_freq = is_opt_freq
    mock_exec.job_title = job_title
    mock_exec.checkpoint_file = checkpoint_file
    return mock_exec


def _make_snapshot_dict(
    *,
    negative_frequencies: int = 0,
    imaginary_frequency: float = 0.0,
    free_energy: float = -100.0,
    thermal_enthalpy: float = -99.9,
    zero_point_energy: float = -99.85,
    temperature: float = 298.15,
    is_provided: bool = True,
) -> EasyRateStructureSnapshot:
    """Crea un diccionario snapshot tipado para pruebas de validación."""
    return EasyRateStructureSnapshot(
        source_field="test_field",
        original_filename="test.log",
        is_provided=is_provided,
        execution_index=0,
        available_execution_count=1,
        job_title=None,
        checkpoint_file=None,
        charge=0,
        multiplicity=1,
        free_energy=free_energy,
        thermal_enthalpy=thermal_enthalpy,
        zero_point_energy=zero_point_energy,
        scf_energy=-100.2,
        temperature=temperature,
        negative_frequencies=negative_frequencies,
        imaginary_frequency=imaginary_frequency,
        normal_termination=True,
        is_opt_freq=True,
    )


# =========================
# _to_optional_finite
# =========================


class ToOptionalFiniteTests(TestCase):
    """Prueba la normalización de valores no finitos a None."""

    def test_none_input_returns_none(self) -> None:
        """None como entrada retorna None directamente."""
        self.assertIsNone(_to_optional_finite(None))

    def test_inf_returns_none(self) -> None:
        """Infinito positivo retorna None."""
        self.assertIsNone(_to_optional_finite(float("inf")))

    def test_nan_returns_none(self) -> None:
        """NaN retorna None."""
        self.assertIsNone(_to_optional_finite(float("nan")))

    def test_valid_float_returns_itself(self) -> None:
        """Float finito válido retorna el mismo valor."""
        self.assertAlmostEqual(_to_optional_finite(-99.85), -99.85)


# =========================
# _build_structure_snapshot
# =========================


class BuildStructureSnapshotTests(TestCase):
    """Prueba la normalización de frecuencias en el snapshot de estructura."""

    def test_imaginary_freq_gt_zero_with_no_neg_freq_normalizes_to_one(self) -> None:
        """Cuando imaginary_frequency > 0 pero negative_frequencies = 0, se normaliza a 1."""
        mock_exec = _make_mock_execution(
            imaginary_frequency=300.0,
            negative_frequencies=0,
        )
        snapshot = _build_structure_snapshot(
            source_field="transition_state_file",
            execution=mock_exec,
            original_filename="ts.log",
            execution_index=0,
            available_execution_count=1,
        )
        # Si imaginary_frequency > 0 y negative_frequencies era 0, debe quedar en 1.
        self.assertEqual(snapshot["negative_frequencies"], 1)
        self.assertGreater(snapshot["imaginary_frequency"], 0.0)

    def test_non_finite_imaginary_freq_normalized_to_zero(self) -> None:
        """Frecuencia imaginaria no finita se normaliza a 0.0."""
        mock_exec = _make_mock_execution(
            imaginary_frequency=float("inf"),
            negative_frequencies=0,
        )
        snapshot = _build_structure_snapshot(
            source_field="reactant_1_file",
            execution=mock_exec,
            original_filename="r.log",
            execution_index=0,
            available_execution_count=1,
        )
        self.assertEqual(snapshot["imaginary_frequency"], 0.0)
        self.assertEqual(snapshot["negative_frequencies"], 0)

    def test_checkpoint_file_stripped_to_none_if_empty(self) -> None:
        """Checkpoint vacío se almacena como None."""
        mock_exec = _make_mock_execution(checkpoint_file="   ")
        snapshot = _build_structure_snapshot(
            source_field="reactant_1_file",
            execution=mock_exec,
            original_filename="r.log",
            execution_index=0,
            available_execution_count=1,
        )
        self.assertIsNone(snapshot["checkpoint_file"])

    def test_job_title_stripped_to_none_if_empty(self) -> None:
        """Job title vacío se almacena como None."""
        mock_exec = _make_mock_execution(job_title="  ")
        snapshot = _build_structure_snapshot(
            source_field="reactant_1_file",
            execution=mock_exec,
            original_filename="r.log",
            execution_index=0,
            available_execution_count=1,
        )
        self.assertIsNone(snapshot["job_title"])


# =========================
# _collect_structure_validation_errors
# =========================


class CollectStructureValidationErrorsTests(TestCase):
    """Prueba la recopilación de errores de validación por rol."""

    def test_not_provided_returns_empty(self) -> None:
        """Estructura no provista no genera errores de validación."""
        snapshot = _make_snapshot_dict(is_provided=False)
        errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role="reactant_1_file",
        )
        self.assertEqual(errors, [])

    def test_ts_missing_imaginary_frequency_adds_error(self) -> None:
        """Transition state sin frecuencia imaginaria válida genera error."""
        snapshot = _make_snapshot_dict(imaginary_frequency=0.0, negative_frequencies=1)
        errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role="transition_state_file",
        )
        self.assertTrue(any("imaginaria" in e.lower() for e in errors))

    def test_ts_wrong_negative_freq_count_adds_error(self) -> None:
        """Transition state con != 1 frecuencia negativa genera error."""
        snapshot = _make_snapshot_dict(
            imaginary_frequency=300.0, negative_frequencies=2
        )
        errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role="transition_state_file",
        )
        self.assertTrue(any("imaginaria" in e.lower() for e in errors))

    def test_reactant_with_negative_frequencies_adds_error(self) -> None:
        """Reactivo con frecuencias imaginarias debe tener error de validación."""
        snapshot = _make_snapshot_dict(
            negative_frequencies=1, imaginary_frequency=200.0
        )
        errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role="reactant_1_file",
        )
        self.assertTrue(
            any("frecuencia" in e.lower() or "imaginaria" in e.lower() for e in errors)
        )

    def test_valid_reactant_no_neg_freq_returns_empty(self) -> None:
        """Reactivo válido sin frecuencias imaginarias no genera errores."""
        snapshot = _make_snapshot_dict(negative_frequencies=0, imaginary_frequency=0.0)
        errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role="reactant_2_file",
        )
        self.assertEqual(errors, [])


# =========================
# _validate_structure_snapshot
# =========================


class ValidateStructureSnapshotTests(TestCase):
    """Prueba que _validate_structure_snapshot lanza ValueError con errores."""

    def test_invalid_ts_raises_value_error(self) -> None:
        """Snapshot de TS inválido debe lanzar ValueError con descripción."""
        snapshot = _make_snapshot_dict(
            imaginary_frequency=0.0,
            negative_frequencies=0,
        )
        with self.assertRaises(ValueError) as ctx:
            _validate_structure_snapshot(
                snapshot=snapshot,
                expected_role="transition_state_file",
            )
        self.assertIn("transition_state_file", str(ctx.exception))

    def test_valid_ts_does_not_raise(self) -> None:
        """Snapshot de TS válido no debe lanzar excepción."""
        snapshot = _make_snapshot_dict(
            imaginary_frequency=625.0,
            negative_frequencies=1,
        )
        # No debe lanzar excepción
        _validate_structure_snapshot(
            snapshot=snapshot,
            expected_role="transition_state_file",
        )

    def test_invalid_reactant_raises_value_error(self) -> None:
        """Reactivo con frecuencias negativas debe lanzar ValueError."""
        snapshot = _make_snapshot_dict(
            negative_frequencies=1,
            imaginary_frequency=150.0,
        )
        with self.assertRaises(ValueError):
            _validate_structure_snapshot(
                snapshot=snapshot,
                expected_role="reactant_1_file",
            )


# =========================
# _parse_gaussian_execution
# =========================


class ParseGaussianExecutionTests(TestCase):
    """Prueba el parseo de архивов Gaussian con errores de ejecución."""

    def test_no_executions_raises_with_errors(self) -> None:
        """Parser sin ejecuciones válidas debe lanzar ValueError con errores concatenados."""
        mock_parser = MagicMock()
        mock_result = MagicMock()
        mock_result.execution_count = 0
        mock_result.errors = ["No se encontró terminación normal.", "Archivo truncado."]
        mock_parser.parse_blob.return_value = mock_result

        with self.assertRaises(ValueError) as ctx:
            _parse_gaussian_execution(
                parser=mock_parser,
                artifact_bytes=b"fake content",
                original_filename="test.log",
                selected_execution_index=None,
            )
        self.assertIn("test.log", str(ctx.exception))

    def test_no_executions_empty_errors_raises_with_generic(self) -> None:
        """Parser sin ejecuciones y sin mensajes de error usa mensaje genérico."""
        mock_parser = MagicMock()
        mock_result = MagicMock()
        mock_result.execution_count = 0
        mock_result.errors = []
        mock_parser.parse_blob.return_value = mock_result

        with self.assertRaises(ValueError) as ctx:
            _parse_gaussian_execution(
                parser=mock_parser,
                artifact_bytes=b"fake content",
                original_filename="missing.log",
                selected_execution_index=None,
            )
        self.assertIn("válidas", str(ctx.exception))

    def test_out_of_range_execution_index_raises(self) -> None:
        """Índice de ejecución fuera de rango debe lanzar ValueError."""
        mock_parser = MagicMock()
        mock_result = MagicMock()
        mock_result.execution_count = 2
        mock_result.errors = []
        mock_result.executions = [MagicMock(), MagicMock()]
        mock_parser.parse_blob.return_value = mock_result

        with self.assertRaises(ValueError) as ctx:
            _parse_gaussian_execution(
                parser=mock_parser,
                artifact_bytes=b"fake content",
                original_filename="test.log",
                selected_execution_index=5,
            )
        self.assertIn("test.log", str(ctx.exception))

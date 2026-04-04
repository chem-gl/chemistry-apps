"""test_plugin_unit.py: Pruebas unitarias focalizadas en app/sa_score/plugin.py.

Objetivo del archivo:
- Cubrir caminos de error y éxito de las funciones internas del plugin SA Score
  que no son alcanzadas por los tests de integración HTTP.
- Las dependencias externas (AmbitClient, BrsaScoreClient, RdkitSaClient) se
  mockean para aislar la lógica del plugin.

Cómo se usa:
- Ejecutar con `python manage.py test apps.sa_score.test_plugin_unit`.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.sa_score.plugin import (
    _build_molecule_result,
    _compute_ambit_score,
    _compute_brsa_score,
    _compute_method_score,
    _compute_rdkit_score,
    _convert_score,
)


class ConvertScoreTests(SimpleTestCase):
    """Pruebas para la conversión de escala SA clásica (1-10) a AMBIT-SA (0-100)."""

    def test_score_1_maps_to_100(self) -> None:
        """SA score 1 (fácil de sintetizar) debe mapearse a 100."""
        self.assertAlmostEqual(_convert_score(1.0), 100.0, places=5)

    def test_score_10_maps_to_0(self) -> None:
        """SA score 10 (difícil de sintetizar) debe mapearse a 0."""
        self.assertAlmostEqual(_convert_score(10.0), 0.0, places=5)

    def test_score_5_5_maps_to_50(self) -> None:
        """SA score 5.5 debe mapearse aproximadamente a 50."""
        self.assertAlmostEqual(_convert_score(5.5), 50.0, places=2)

    def test_score_clamped_below_zero(self) -> None:
        """Scores > 10 no deben producir valores negativos."""
        result = _convert_score(15.0)
        self.assertGreaterEqual(result, 0.0)

    def test_score_clamped_above_100(self) -> None:
        """Scores < 1 no deben superar 100."""
        result = _convert_score(-5.0)
        self.assertLessEqual(result, 100.0)


class ComputeMethodScoreDispatchTests(SimpleTestCase):
    """Pruebas para _compute_method_score y su despacho a funciones específicas."""

    def test_dispatches_to_ambit(self) -> None:
        """El método 'ambit' delega a _compute_ambit_score."""
        with patch(
            "apps.sa_score.plugin._compute_ambit_score", return_value=(42.0, None)
        ) as mock_ambit:
            score, error = _compute_method_score("ambit", "CCO")
        mock_ambit.assert_called_once_with("CCO")
        self.assertEqual(score, 42.0)
        self.assertIsNone(error)

    def test_dispatches_to_brsa(self) -> None:
        """El método 'brsa' delega a _compute_brsa_score."""
        with patch(
            "apps.sa_score.plugin._compute_brsa_score", return_value=(75.0, None)
        ) as mock_brsa:
            score, error = _compute_method_score("brsa", "CCO")
        mock_brsa.assert_called_once_with("CCO")
        self.assertEqual(score, 75.0)

    def test_dispatches_to_rdkit(self) -> None:
        """El método 'rdkit' delega a _compute_rdkit_score."""
        with patch(
            "apps.sa_score.plugin._compute_rdkit_score", return_value=(60.0, None)
        ) as mock_rdkit:
            score, error = _compute_method_score("rdkit", "CCO")
        mock_rdkit.assert_called_once_with("CCO")
        self.assertEqual(score, 60.0)

    def test_returns_none_for_unsupported_method(self) -> None:
        """Un método desconocido retorna (None, mensaje_error) sin lanzar excepción."""
        score, error = _compute_method_score("unknown_method", "CCO")
        self.assertIsNone(score)
        self.assertIsNotNone(error)
        self.assertIn("unknown_method", error)


class ComputeAmbitScoreTests(SimpleTestCase):
    """Pruebas para _compute_ambit_score con cliente AMBIT mockeado."""

    def _make_ambit_result(
        self, success: bool, sa_score: float | None = None, error: str | None = None
    ) -> MagicMock:
        """Crea un resultado simulado de AmbitClient."""
        mock_result = MagicMock()
        mock_result.success = success
        mock_result.sa_score = sa_score
        mock_result.error_message = error
        return mock_result

    def test_returns_score_when_client_succeeds(self) -> None:
        """Cuando AmbitClient.predict_sa_score retorna éxito, se devuelve el score."""
        ambit_result = self._make_ambit_result(success=True, sa_score=88.5)

        mock_client_instance = MagicMock()
        mock_client_instance.predict_sa_score.return_value = ambit_result

        with patch("apps.sa_score.plugin._compute_ambit_score") as mock_fn:
            mock_fn.return_value = (88.5, None)
            score, error = _compute_method_score("ambit", "CCO")

        self.assertIsNone(error)
        self.assertEqual(score, 88.5)

    def test_returns_error_when_import_fails(self) -> None:
        """Si la importación de AmbitClient falla, retorna (None, mensaje_error)."""
        with patch(
            "builtins.__import__", side_effect=ImportError("ambit not available")
        ):
            score, error = _compute_ambit_score("CCO")

        self.assertIsNone(score)
        self.assertIsNotNone(error)

    def test_returns_error_message_when_client_fails(self) -> None:
        """Cuando AmbitClient.predict_sa_score retorna success=False, se devuelve el error."""
        ambit_result = MagicMock()
        ambit_result.success = False
        ambit_result.error_message = "JAR no encontrado"

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = ambit_result

        with patch("apps.sa_score.plugin._compute_ambit_score") as mock_fn:
            mock_fn.return_value = (None, "JAR no encontrado")
            score, error = _compute_method_score("ambit", "CCO")

        self.assertIsNone(score)
        self.assertEqual(error, "JAR no encontrado")


class ComputeBrsaScoreTests(SimpleTestCase):
    """Pruebas para _compute_brsa_score con BrsaScoreClient mockeado."""

    def test_returns_converted_score_on_success(self) -> None:
        """BrsaScoreClient con éxito y score válido retorna score convertido."""
        brsa_result = MagicMock()
        brsa_result.success = True
        brsa_result.sa_score = 3.0  # escala 1-10

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = brsa_result
        mock_client_class = MagicMock(return_value=mock_client)

        with patch.dict(
            "sys.modules",
            {"libs.brsascore.client": MagicMock(BrsaScoreClient=mock_client_class)},
        ):
            score, error = _compute_brsa_score("CCO")

        self.assertIsNone(error)
        self.assertIsNotNone(score)
        # Score 3.0 en escala 1-10 → debería convertirse a ~77.8 en escala 0-100
        self.assertAlmostEqual(score, _convert_score(3.0), places=4)

    def test_returns_error_when_score_is_none(self) -> None:
        """Si BrsaScoreClient retorna sa_score=None (score vacío), retorna mensaje de error."""
        brsa_result = MagicMock()
        brsa_result.success = True
        brsa_result.sa_score = None  # sin score

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = brsa_result
        mock_client_class = MagicMock(return_value=mock_client)

        with patch.dict(
            "sys.modules",
            {"libs.brsascore.client": MagicMock(BrsaScoreClient=mock_client_class)},
        ):
            score, error = _compute_brsa_score("CCO")

        self.assertIsNone(score)
        self.assertIn("score vacío", error)

    def test_returns_error_when_client_exception(self) -> None:
        """Cuando el cliente lanza excepción, retorna (None, error_message)."""
        with patch(
            "builtins.__import__", side_effect=ImportError("brsa not available")
        ):
            score, error = _compute_brsa_score("CCO")

        self.assertIsNone(score)
        self.assertIsNotNone(error)

    def test_returns_error_when_client_success_false(self) -> None:
        """BrsaScoreClient con success=False retorna el mensaje de error del cliente."""
        brsa_result = MagicMock()
        brsa_result.success = False
        brsa_result.error_message = "RDKit falló"

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = brsa_result
        mock_client_class = MagicMock(return_value=mock_client)

        with patch.dict(
            "sys.modules",
            {"libs.brsascore.client": MagicMock(BrsaScoreClient=mock_client_class)},
        ):
            score, error = _compute_brsa_score("CCO")

        self.assertIsNone(score)
        self.assertEqual(error, "RDKit falló")


class ComputeRdkitScoreTests(SimpleTestCase):
    """Pruebas para _compute_rdkit_score con RdkitSaClient mockeado."""

    def test_returns_converted_score_on_success(self) -> None:
        """RdkitSaClient con éxito y score válido retorna score convertido a escala 0-100."""
        rdkit_result = MagicMock()
        rdkit_result.success = True
        rdkit_result.sa_score = 2.0  # escala 1-10

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = rdkit_result
        mock_client_class = MagicMock(return_value=mock_client)

        with patch.dict(
            "sys.modules",
            {"libs.rdkit_sa.client": MagicMock(RdkitSaClient=mock_client_class)},
        ):
            score, error = _compute_rdkit_score("CCO")

        self.assertIsNone(error)
        self.assertIsNotNone(score)
        self.assertAlmostEqual(score, _convert_score(2.0), places=4)

    def test_returns_error_when_score_is_none(self) -> None:
        """Si RdkitSaClient retorna sa_score=None, retorna mensaje de error."""
        rdkit_result = MagicMock()
        rdkit_result.success = True
        rdkit_result.sa_score = None

        mock_client = MagicMock()
        mock_client.predict_sa_score.return_value = rdkit_result
        mock_client_class = MagicMock(return_value=mock_client)

        with patch.dict(
            "sys.modules",
            {"libs.rdkit_sa.client": MagicMock(RdkitSaClient=mock_client_class)},
        ):
            score, error = _compute_rdkit_score("CCO")

        self.assertIsNone(score)
        self.assertIn("score vacío", error)

    def test_returns_error_when_import_fails(self) -> None:
        """Cuando la importación falla, retorna (None, error_message)."""
        with patch(
            "builtins.__import__", side_effect=ImportError("rdkit_sa not found")
        ):
            score, error = _compute_rdkit_score("CCO")

        self.assertIsNone(score)
        self.assertIsNotNone(error)


class BuildMoleculeResultTests(SimpleTestCase):
    """Pruebas para _build_molecule_result que agrega resultados por método."""

    def test_populates_brsa_result(self) -> None:
        """El resultado del método brsa se asigna correctamente al campo brsa_sa."""
        log_calls: list[tuple[str, ...]] = []

        def log_mock(level: str, source: str, message: str, extras: object) -> None:
            log_calls.append((level, source, message))

        with patch(
            "apps.sa_score.plugin._compute_method_score", return_value=(75.0, None)
        ):
            result = _build_molecule_result("CCO", ["brsa"], log_mock)

        self.assertEqual(result["smiles"], "CCO")
        self.assertEqual(result["brsa_sa"], 75.0)
        self.assertIsNone(result["brsa_error"])

    def test_logs_warning_when_method_fails(self) -> None:
        """Cuando un método falla, se registra un aviso en el log_callback."""
        log_calls: list[tuple[str, ...]] = []

        def log_mock(level: str, source: str, message: str, extras: object) -> None:
            log_calls.append((level, source, message))

        with patch(
            "apps.sa_score.plugin._compute_method_score",
            return_value=(None, "error de cómputo"),
        ):
            _build_molecule_result("CCO", ["rdkit"], log_mock)

        self.assertTrue(any("warning" in call[0] for call in log_calls))

"""
# ambit/tests.py

Pruebas unitarias para la librería Ambit de cálculo SA score.
Valida parseo de salida, manejo de errores y procesamiento batch.

Uso:
    python -m unittest backend.libs.ambit.tests -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

# Soporte para ejecución directa del archivo:
# python backend/libs/ambit/tests.py
if __package__ in {None, ""}:
    current_directory: Path = Path(__file__).resolve().parent
    repository_root: Path = current_directory.parents[2]

    # Evita sombrear módulos estándar cuando hay módulos locales con nombres comunes.
    try:
        sys.path.remove(str(current_directory))
    except ValueError:
        pass

    if str(repository_root) not in sys.path:
        sys.path.insert(0, str(repository_root))

    from backend.libs.ambit.client import AmbitClient
    from backend.libs.runtime_support import RuntimePathsResolver
else:
    from ..runtime_support import RuntimePathsResolver
    from .client import AmbitClient


class _FakeRuntimeResolver(RuntimePathsResolver):
    """Resolver de pruebas que evita depender de archivos reales."""

    def get_java8_bin_path(self) -> Path:
        return Path("/fake/java8/bin/java")

    def get_ambit_jar_path(self) -> Path:
        return Path("/fake/ambit/SyntheticAccessibilityCli.jar")

    def assert_executable(self, executable_path: Path, label: str) -> None:
        del executable_path
        del label

    def assert_file(self, file_path: Path, label: str) -> None:
        del file_path
        del label


class AmbitClientTests(unittest.TestCase):
    """Pruebas de comportamiento del cliente Ambit."""

    def setUp(self) -> None:
        self.client = AmbitClient(runtime_resolver=_FakeRuntimeResolver())

    def test_predict_sa_score_parses_decimal_with_comma(self) -> None:
        """Debe parsear correctamente formato decimal con coma de Ambit."""
        completed_process = self._build_completed_process(
            return_code=0,
            stdout_value="Calculating SA for: CCO\nSA = 99,467\n",
            stderr_value="",
        )

        with patch("subprocess.run", return_value=completed_process):
            result = self.client.predict_sa_score("CCO")

        self.assertTrue(result.success)
        self.assertAlmostEqual(result.sa_score or 0.0, 99.467, places=3)
        self.assertIsNone(result.error_message)

    def test_predict_sa_score_handles_non_zero_return_code(self) -> None:
        """Debe reportar error cuando Ambit retorna código distinto de cero."""
        completed_process = self._build_completed_process(
            return_code=2,
            stdout_value="",
            stderr_value="Invalid smiles",
        )

        with patch("subprocess.run", return_value=completed_process):
            result = self.client.predict_sa_score("INVALID")

        self.assertFalse(result.success)
        self.assertIsNone(result.sa_score)
        self.assertIsNotNone(result.error_message)

    def test_predict_sa_scores_batch_summary(self) -> None:
        """Debe calcular múltiples SMILES y devolver resumen agregado correcto."""
        first_output = self._build_completed_process(
            return_code=0,
            stdout_value="SA = 75,5",
            stderr_value="",
        )
        second_output = self._build_completed_process(
            return_code=0,
            stdout_value="SA = 43,2",
            stderr_value="",
        )

        with patch("subprocess.run", side_effect=[first_output, second_output]):
            batch_result = self.client.predict_sa_scores(["CCO", "c1ccccc1"])

        serialized = batch_result.to_dict()
        self.assertEqual(serialized["total"], 2)
        self.assertEqual(serialized["successful"], 2)
        self.assertEqual(serialized["failed"], 0)

    @staticmethod
    def _build_completed_process(
        *,
        return_code: int,
        stdout_value: str,
        stderr_value: str,
    ) -> object:
        """Crea objeto equivalente a CompletedProcess para mocking."""

        class _CompletedProcess:
            def __init__(self, rc: int, stdout_text: str, stderr_text: str) -> None:
                self.returncode = rc
                self.stdout = stdout_text
                self.stderr = stderr_text

        return _CompletedProcess(return_code, stdout_value, stderr_value)


if __name__ == "__main__":
    unittest.main()

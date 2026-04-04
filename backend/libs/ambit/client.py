"""
# ambit/client.py

Cliente de alto nivel para calcular SA score con SyntheticAccessibilityCli.jar.
Expone API para un SMILES o lista de SMILES con manejo robusto de errores.

Uso:
    from libs.ambit.client import predict_sa_score, predict_sa_scores

    single = predict_sa_score("CCO")
    batch = predict_sa_scores(["CCO", "c1ccccc1"])
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from ..runtime_support import RuntimePathsResolver, SmilesInput, normalize_smiles_input
from .models import AmbitBatchResult, AmbitScoreResult


class AmbitExecutionError(RuntimeError):
    """Error operativo durante la invocación de Ambit."""


class AmbitClient:
    """Cliente para ejecutar SyntheticAccessibilityCli.jar y obtener SA score."""

    def __init__(
        self,
        runtime_resolver: RuntimePathsResolver | None = None,
        timeout_seconds: int = 120,
    ) -> None:
        self.runtime_resolver: RuntimePathsResolver = (
            runtime_resolver if runtime_resolver is not None else RuntimePathsResolver()
        )
        self.timeout_seconds: int = timeout_seconds

    def predict_sa_score(self, smiles: str) -> AmbitScoreResult:
        """Calcula SA score para un solo SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles)
        return self._run_single_smiles(normalized_smiles_list[0])

    def predict_sa_scores(self, smiles_input: SmilesInput) -> AmbitBatchResult:
        """Calcula SA score para una lista de SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles_input)
        batch_results: list[AmbitScoreResult] = []

        for smiles_value in normalized_smiles_list:
            batch_results.append(self._run_single_smiles(smiles_value))

        return AmbitBatchResult(results=batch_results)

    def _run_single_smiles(self, smiles_value: str) -> AmbitScoreResult:
        """Ejecuta Ambit para un SMILES y parsea el score numérico."""
        try:
            java_bin_path: Path = self.runtime_resolver.get_java8_bin_path()
            jar_path: Path = self.runtime_resolver.get_ambit_jar_path()
            self.runtime_resolver.assert_executable(java_bin_path, "Java 8")
            self.runtime_resolver.assert_file(jar_path, "SyntheticAccessibilityCli.jar")

            command: list[str] = [
                java_bin_path.as_posix(),
                "-jar",
                jar_path.as_posix(),
                "-s",
                smiles_value,
            ]

            completed_process = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                check=False,
            )
            raw_output: str = self._merge_output(
                completed_process.stdout,
                completed_process.stderr,
            )

            if completed_process.returncode != 0:
                return AmbitScoreResult(
                    smiles=smiles_value,
                    sa_score=None,
                    success=False,
                    error_message=(
                        "Ambit retornó código "
                        f"{completed_process.returncode}: {raw_output.strip()}"
                    ),
                )

            score_value: float | None = self._extract_sa_score(raw_output)
            if score_value is None:
                return AmbitScoreResult(
                    smiles=smiles_value,
                    sa_score=None,
                    success=False,
                    error_message=(
                        "No fue posible extraer SA score desde la salida de Ambit."
                    ),
                )

            return AmbitScoreResult(
                smiles=smiles_value,
                sa_score=score_value,
                success=True,
            )
        except subprocess.TimeoutExpired:
            return AmbitScoreResult(
                smiles=smiles_value,
                sa_score=None,
                success=False,
                error_message=(
                    f"Ambit excedió timeout de {self.timeout_seconds} segundos."
                ),
            )
        except Exception as exc:  # noqa: BLE001
            return AmbitScoreResult(
                smiles=smiles_value,
                sa_score=None,
                success=False,
                error_message=f"Error ejecutando Ambit: {exc}",
            )

    @staticmethod
    def _merge_output(stdout_value: str, stderr_value: str) -> str:
        """Une stdout/stderr de forma segura para diagnóstico y parseo."""
        stdout_clean: str = stdout_value.strip()
        stderr_clean: str = stderr_value.strip()

        if stdout_clean == "" and stderr_clean == "":
            return ""
        if stdout_clean == "":
            return stderr_clean
        if stderr_clean == "":
            return stdout_clean
        return f"{stdout_clean}\n{stderr_clean}"

    @staticmethod
    def _extract_sa_score(raw_output: str) -> float | None:
        """Extrae SA score desde salida textual de Ambit con tolerancia decimal."""
        # Ambit imprime típicamente: "SA = 99,467"
        match = re.search(r"SA\s*=\s*(\d+(?:[\.,]\d+)?)", raw_output)
        if match is None:
            return None

        normalized_value: str = match.group(1).replace(",", ".")
        try:
            return float(normalized_value)
        except ValueError:
            return None


def predict_sa_score(smiles: str) -> dict[str, str | float | bool | None]:
    """Atajo funcional para SA score de una sola molécula."""
    return AmbitClient().predict_sa_score(smiles).to_dict()


def predict_sa_scores(
    smiles_input: SmilesInput,
) -> dict[str, object]:
    """Atajo funcional para SA score de múltiples moléculas."""
    return AmbitClient().predict_sa_scores(smiles_input).to_dict()

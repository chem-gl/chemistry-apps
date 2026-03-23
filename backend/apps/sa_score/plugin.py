"""plugin.py: Implementación del plugin de SA Score desacoplado y reutilizable.

Calcula accesibilidad sintética para una lista de SMILES usando tres métodos:
1. AMBIT (SyntheticAccessibilityCli.jar via Java 8)
2. BRSAScore (librería vendorizada con RDKit)
3. RDKit SA Score nativo (rdkit.Contrib.SA_Score.sascorer)

El usuario elige qué métodos ejecutar mediante el parámetro `methods`.
El progreso se reporta por molécula procesada para visualización en tiempo real.

Cómo se usa:
- El plugin queda registrado automáticamente al importar este módulo en apps.py.
- El core de jobs invoca sa_score_plugin(parameters, progress_cb, log_cb).
"""

from __future__ import annotations

import logging
from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    PLUGIN_NAME,
    SA_SCORE_METHOD_AMBIT,
    SA_SCORE_METHOD_BRSA,
    SA_SCORE_METHOD_RDKIT,
)
from .types import SaMoleculeResult, SaScoreJobResult

logger = logging.getLogger(__name__)


def _convert_score(raw_score: float) -> float:
    """Convierte score SA clásico (1-10) a escala AMBIT-SA (0-100).

    - 1 (fácil de sintetizar)  -> 100
    - 10 (difícil de sintetizar) -> 0
    """
    sa_score: float = 100.0 - ((raw_score - 1.0) * (100.0 / 9.0))
    return max(0.0, min(100.0, sa_score))


def _compute_ambit_score(smiles_value: str) -> tuple[float | None, str | None]:
    """Calcula SA score con AMBIT. Retorna (score, error)."""
    try:
        from libs.ambit.client import AmbitClient

        result = AmbitClient().predict_sa_score(smiles_value)
        if result.success:
            return result.sa_score, None
        return None, result.error_message
    except Exception as exc:  # noqa: BLE001
        return None, f"Error importando/ejecutando AMBIT: {exc}"


def _compute_brsa_score(smiles_value: str) -> tuple[float | None, str | None]:
    """Calcula BR-SA score con BRSAScore. Retorna (score, error)."""
    try:
        from libs.brsascore.client import BrsaScoreClient

        result = BrsaScoreClient().predict_sa_score(smiles_value)
        if result.success:
            if result.sa_score is None:
                return None, "BRSAScore retornó score vacío."
            return _convert_score(float(result.sa_score)), None
        return None, result.error_message
    except Exception as exc:  # noqa: BLE001
        return None, f"Error importando/ejecutando BRSAScore: {exc}"


def _compute_rdkit_score(smiles_value: str) -> tuple[float | None, str | None]:
    """Calcula SA score nativo de RDKit. Retorna (score, error)."""
    try:
        from libs.rdkit_sa.client import RdkitSaClient

        result = RdkitSaClient().predict_sa_score(smiles_value)
        if result.success:
            if result.sa_score is None:
                return None, "RDKit SA Score retornó score vacío."
            return _convert_score(float(result.sa_score)), None
        return None, result.error_message
    except Exception as exc:  # noqa: BLE001
        return None, f"Error importando/ejecutando RDKit SA Score: {exc}"


@PluginRegistry.register(PLUGIN_NAME)
def sa_score_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback,
) -> JSONMap:
    """Ejecuta el cálculo de accesibilidad sintética para una lista de SMILES.

    Parámetros esperados en `parameters`:
    - smiles_list: list[str] — SMILES a evaluar.
    - methods: list[str] — métodos a usar: "ambit", "brsa", "rdkit".

    Retorna JSONMap compatible con SaScoreJobResult.
    """
    smiles_list: list[str] = cast(list[str], parameters["smiles_list"])
    requested_methods: list[str] = cast(list[str], parameters["methods"])

    total_smiles: int = len(smiles_list)
    molecule_results: list[SaMoleculeResult] = []

    log_callback(
        "info",
        "sa_score_plugin",
        f"Iniciando cálculo SA score para {total_smiles} SMILES con métodos: "
        f"{', '.join(requested_methods)}",
        {},
    )

    for index, smiles_value in enumerate(smiles_list):
        # Inicializar scores y errores para esta molécula
        ambit_sa: float | None = None
        brsa_sa: float | None = None
        rdkit_sa: float | None = None
        ambit_error: str | None = None
        brsa_error: str | None = None
        rdkit_error: str | None = None

        log_callback(
            "debug",
            "sa_score_plugin",
            f"Procesando SMILES {index + 1}/{total_smiles}: {smiles_value}",
            {"smiles": smiles_value, "index": index},
        )

        # --- Método AMBIT ---
        if SA_SCORE_METHOD_AMBIT in requested_methods:
            ambit_sa, ambit_error = _compute_ambit_score(smiles_value)
            if ambit_error is not None:
                log_callback(
                    "warning",
                    "ambit",
                    f"AMBIT falló para {smiles_value}: {ambit_error}",
                    {"smiles": smiles_value},
                )

        # --- Método BRSAScore ---
        if SA_SCORE_METHOD_BRSA in requested_methods:
            brsa_sa, brsa_error = _compute_brsa_score(smiles_value)
            if brsa_error is not None:
                log_callback(
                    "warning",
                    "brsa",
                    f"BRSAScore falló para {smiles_value}: {brsa_error}",
                    {"smiles": smiles_value},
                )

        # --- Método RDKit SA Score ---
        if SA_SCORE_METHOD_RDKIT in requested_methods:
            rdkit_sa, rdkit_error = _compute_rdkit_score(smiles_value)
            if rdkit_error is not None:
                log_callback(
                    "warning",
                    "rdkit",
                    f"RDKit SA Score falló para {smiles_value}: {rdkit_error}",
                    {"smiles": smiles_value},
                )

        molecule_result: SaMoleculeResult = {
            "smiles": smiles_value,
            "ambit_sa": ambit_sa,
            "brsa_sa": brsa_sa,
            "rdkit_sa": rdkit_sa,
            "ambit_error": ambit_error,
            "brsa_error": brsa_error,
            "rdkit_error": rdkit_error,
        }
        molecule_results.append(molecule_result)

        # Reportar progreso: porcentaje basado en moléculas procesadas
        progress_percentage: int = int((index + 1) / total_smiles * 100)
        progress_callback(
            progress_percentage,
            "computing",
            f"Procesado {index + 1}/{total_smiles}: {smiles_value}",
        )

    log_callback(
        "info",
        "sa_score_plugin",
        f"Cálculo SA score completado. {total_smiles} moléculas procesadas.",
        {"total": total_smiles, "methods": requested_methods},
    )

    job_result: SaScoreJobResult = {
        "molecules": molecule_results,
        "total": total_smiles,
        "requested_methods": requested_methods,
    }

    # Castear a JSONMap para compatibilidad con el contrato del core
    return cast(JSONMap, job_result)

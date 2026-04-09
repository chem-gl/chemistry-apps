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
from .types import SaMoleculeResult, SaScoreJobResult, SaScoreMoleculeInput

logger = logging.getLogger(__name__)


def _compute_method_score(
    method_name: str,
    smiles_value: str,
) -> tuple[float | None, str | None]:
    """Despacha el cálculo por método para aislar ramas condicionales."""
    if method_name == SA_SCORE_METHOD_AMBIT:
        return _compute_ambit_score(smiles_value)
    if method_name == SA_SCORE_METHOD_BRSA:
        return _compute_brsa_score(smiles_value)
    if method_name == SA_SCORE_METHOD_RDKIT:
        return _compute_rdkit_score(smiles_value)
    return None, f"Método no soportado: {method_name}"


def _build_molecule_result(
    molecule_entry: SaScoreMoleculeInput | str,
    requested_methods: list[str],
    log_callback: PluginLogCallback,
) -> SaMoleculeResult:
    """Calcula todos los métodos solicitados para una molécula concreta."""
    normalized_entry: SaScoreMoleculeInput = (
        {"name": molecule_entry, "smiles": molecule_entry}
        if isinstance(molecule_entry, str)
        else molecule_entry
    )
    smiles_value: str = normalized_entry["smiles"]
    result: SaMoleculeResult = {
        "name": normalized_entry["name"],
        "smiles": smiles_value,
        "ambit_sa": None,
        "brsa_sa": None,
        "rdkit_sa": None,
        "ambit_error": None,
        "brsa_error": None,
        "rdkit_error": None,
    }
    error_source_map: dict[str, str] = {
        SA_SCORE_METHOD_AMBIT: "ambit",
        SA_SCORE_METHOD_BRSA: "brsa",
        SA_SCORE_METHOD_RDKIT: "rdkit",
    }

    for method_name in requested_methods:
        score_value, error_message = _compute_method_score(method_name, smiles_value)

        if method_name == SA_SCORE_METHOD_AMBIT:
            result["ambit_sa"] = score_value
            result["ambit_error"] = error_message
        elif method_name == SA_SCORE_METHOD_BRSA:
            result["brsa_sa"] = score_value
            result["brsa_error"] = error_message
        elif method_name == SA_SCORE_METHOD_RDKIT:
            result["rdkit_sa"] = score_value
            result["rdkit_error"] = error_message

        if error_message is not None:
            log_callback(
                "warning",
                error_source_map.get(method_name, "sa_score_plugin"),
                f"{method_name} falló para {smiles_value}: {error_message}",
                {"smiles": smiles_value},
            )

    return result


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
    molecules: list[SaScoreMoleculeInput] = cast(
        list[SaScoreMoleculeInput], parameters["molecules"]
    )
    requested_methods: list[str] = cast(list[str], parameters["methods"])

    total_smiles: int = len(molecules)
    molecule_results: list[SaMoleculeResult] = []

    log_callback(
        "info",
        "sa_score_plugin",
        f"Iniciando cálculo SA score para {total_smiles} SMILES con métodos: "
        f"{', '.join(requested_methods)}",
        {},
    )

    for index, molecule_entry in enumerate(molecules):
        smiles_value: str = molecule_entry["smiles"]
        log_callback(
            "debug",
            "sa_score_plugin",
            f"Procesando SMILES {index + 1}/{total_smiles}: {smiles_value}",
            {"smiles": smiles_value, "index": index},
        )

        molecule_result: SaMoleculeResult = _build_molecule_result(
            molecule_entry=molecule_entry,
            requested_methods=requested_methods,
            log_callback=log_callback,
        )
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

"""plugin.py: Ejecución desacoplada de Toxicity Properties con ADMET-AI.

Procesa una lista de SMILES en background y produce una tabla fija de
propiedades toxicológicas por molécula usando inferencia local.
"""

from __future__ import annotations

import logging
from typing import cast

from libs.admet_ai.client import AdmetAiClient
from libs.admet_ai.models import AdmetPredictionResult

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    AMES_POSITIVE_THRESHOLD,
    DEVTOX_POSITIVE_THRESHOLD,
    INFERENCE_CHUNK_SIZE,
    PLUGIN_NAME,
    SCIENTIFIC_REFERENCES,
)
from .types import (
    DevToxLabel,
    MutagenicityLabel,
    ToxicityJobResult,
    ToxicityMoleculeResult,
)

logger = logging.getLogger(__name__)


def _find_prediction_key(keys: list[str], keywords: tuple[str, ...]) -> str | None:
    """Busca una clave en la predicción usando coincidencia parcial por prioridad."""
    normalized_keys: list[str] = [key_name.lower() for key_name in keys]

    for keyword in keywords:
        keyword_lower: str = keyword.lower()
        for key_index, key_name in enumerate(normalized_keys):
            if keyword_lower in key_name:
                return keys[key_index]
    return None


def _find_devtox_key(keys: list[str], excluded_keys: set[str]) -> str | None:
    """Resuelve la mejor clave candidata para toxicidad del desarrollo."""
    primary_key: str | None = _find_prediction_key(keys, ("devtox", "development"))
    if primary_key is not None:
        return primary_key

    for raw_key in keys:
        normalized_key: str = raw_key.lower()
        if "tox" not in normalized_key:
            continue
        if raw_key in excluded_keys:
            continue
        if "ames" in normalized_key:
            continue
        return raw_key

    return None


def _ld50_to_mgkg(log_value: float, smiles_value: str) -> float:
    """Convierte LD50 log-scale a mg/kg usando el peso molecular del SMILES."""
    from rdkit import Chem
    from rdkit.Chem import Descriptors

    molecule = Chem.MolFromSmiles(smiles_value)
    if molecule is None:
        raise ValueError(
            f"SMILES inválido para cálculo de peso molecular: {smiles_value}"
        )

    molecular_weight: float = float(Descriptors.MolWt(molecule))
    return float((10 ** (-log_value)) * molecular_weight * 1000)


def _to_ames_label(score_value: float) -> MutagenicityLabel:
    """Mapea el score de Ames a etiqueta categórica."""
    return "Positive" if score_value >= AMES_POSITIVE_THRESHOLD else "Negative"


def _to_devtox_label(score_value: float) -> DevToxLabel:
    """Mapea el score de DevTox a etiqueta categórica."""
    return "Positive" if score_value >= DEVTOX_POSITIVE_THRESHOLD else "Negative"


def _build_error_result(
    smiles_value: str, error_message: str
) -> ToxicityMoleculeResult:
    """Construye un resultado vacío con mensaje de error por molécula."""
    return {
        "smiles": smiles_value,
        "LD50_mgkg": None,
        "mutagenicity": None,
        "ames_score": None,
        "DevTox": None,
        "devtox_score": None,
        "error_message": error_message,
    }


def _build_molecule_result(
    smiles_value: str,
    prediction_result: AdmetPredictionResult,
) -> ToxicityMoleculeResult:
    """Normaliza la predicción ADMET-AI a las cinco columnas del dominio."""
    if not prediction_result.success:
        return _build_error_result(
            smiles_value,
            prediction_result.error_message or "ADMET-AI retornó error desconocido.",
        )

    prediction_map: dict[str, float] = prediction_result.predictions
    prediction_keys: list[str] = list(prediction_map.keys())

    ld50_key: str | None = _find_prediction_key(prediction_keys, ("ld50", "acute"))
    ames_key: str | None = _find_prediction_key(prediction_keys, ("ames", "mutagen"))
    devtox_key: str | None = _find_devtox_key(
        prediction_keys,
        excluded_keys={
            key_name for key_name in [ld50_key, ames_key] if key_name is not None
        },
    )

    if ld50_key is None or ames_key is None or devtox_key is None:
        return _build_error_result(
            smiles_value,
            (
                "No se pudieron resolver claves toxicológicas requeridas en ADMET-AI. "
                f"Claves recibidas: {', '.join(prediction_keys)}"
            ),
        )

    try:
        ld50_log_value: float = float(prediction_map[ld50_key])
        ames_score_value: float = float(prediction_map[ames_key])
        devtox_score_value: float = float(prediction_map[devtox_key])
        ld50_mgkg_value: float = _ld50_to_mgkg(ld50_log_value, smiles_value)
    except Exception as exc:  # noqa: BLE001
        return _build_error_result(
            smiles_value,
            f"No se pudo transformar la predicción ADMET-AI: {exc}",
        )

    return {
        "smiles": smiles_value,
        "LD50_mgkg": ld50_mgkg_value,
        "mutagenicity": _to_ames_label(ames_score_value),
        "ames_score": ames_score_value,
        "DevTox": _to_devtox_label(devtox_score_value),
        "devtox_score": devtox_score_value,
        "error_message": None,
    }


@PluginRegistry.register(PLUGIN_NAME)
def toxicity_properties_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback,
) -> JSONMap:
    """Ejecuta predicciones toxicológicas para una lista de SMILES."""
    smiles_list: list[str] = cast(list[str], parameters["smiles_list"])
    total_smiles: int = len(smiles_list)
    processed_count: int = 0
    molecule_results: list[ToxicityMoleculeResult] = []
    admet_client = AdmetAiClient()

    # Validación temprana: si falta ADMET-AI o el modelo no carga,
    # se trata como error fatal del job (status=failed), no como fila parcial.
    admet_client.ensure_model_available()

    log_callback(
        "info",
        "toxicity_properties_plugin",
        (f"Iniciando cálculo toxicológico con ADMET-AI para {total_smiles} SMILES."),
        {"chunk_size": INFERENCE_CHUNK_SIZE},
    )

    for chunk_start in range(0, total_smiles, INFERENCE_CHUNK_SIZE):
        chunk_smiles_list: list[str] = smiles_list[
            chunk_start : chunk_start + INFERENCE_CHUNK_SIZE
        ]
        chunk_end_index: int = chunk_start + len(chunk_smiles_list)

        log_callback(
            "debug",
            "toxicity_properties_plugin",
            f"Procesando bloque de SMILES {chunk_start + 1}-{chunk_end_index}.",
            {"chunk_start": chunk_start, "chunk_end": chunk_end_index},
        )

        for smiles_value in chunk_smiles_list:
            prediction_result: AdmetPredictionResult = admet_client.predict_properties(
                smiles_value
            )
            normalized_result: ToxicityMoleculeResult = _build_molecule_result(
                smiles_value=smiles_value,
                prediction_result=prediction_result,
            )

            if normalized_result["error_message"] is not None:
                log_callback(
                    "warning",
                    "toxicity_properties_plugin",
                    (
                        f"Predicción con error para {smiles_value}: "
                        f"{normalized_result['error_message']}"
                    ),
                    {"smiles": smiles_value},
                )

            molecule_results.append(normalized_result)
            processed_count += 1

            progress_percentage: int = int(processed_count / total_smiles * 100)
            progress_callback(
                progress_percentage,
                "running",
                f"Procesado {processed_count}/{total_smiles}: {smiles_value}",
            )

    log_callback(
        "info",
        "toxicity_properties_plugin",
        (
            "Cálculo toxicológico completado con ADMET-AI. "
            f"Moléculas procesadas: {total_smiles}."
        ),
        {},
    )

    result_payload: ToxicityJobResult = {
        "molecules": molecule_results,
        "total": total_smiles,
        "scientific_references": list(SCIENTIFIC_REFERENCES),
    }

    return cast(JSONMap, result_payload)

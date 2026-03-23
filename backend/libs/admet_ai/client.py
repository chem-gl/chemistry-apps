"""client.py: Cliente tipado para ejecutar predicciones toxicológicas con ADMET-AI.

Responsabilidades:
- Cargar ADMET-AI de manera perezosa para minimizar costo de arranque del worker.
- Ejecutar predicción para un SMILES y normalizar la salida a floats serializables.
- Devolver errores controlados cuando la dependencia no está instalada o falla.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from ..runtime_support import SmilesInput, normalize_smiles_input
from .models import AdmetPredictionBatchResult, AdmetPredictionResult


class AdmetAiClient:
    """Cliente de alto nivel para inferencia local con ADMET-AI."""

    _model_instance: object | None = None

    def ensure_model_available(self) -> None:
        """Valida que el modelo ADMET-AI esté disponible para inferencia."""
        self._get_model()

    @classmethod
    def _get_model(cls) -> object:
        """Carga el modelo de ADMET-AI una sola vez por proceso."""
        if cls._model_instance is not None:
            return cls._model_instance

        try:
            from admet_ai import ADMETModel  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "No se pudo importar admet_ai. Instala dependencias con: "
                "pip install admet-ai rdkit-pypi pandas numpy"
            ) from exc

        try:
            # Importante en Celery (ForkPoolWorker daemon):
            # evitar DataLoader multiprocessing para no crear procesos hijos.
            cls._model_instance = ADMETModel(num_workers=0)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"No se pudo inicializar ADMETModel de admet_ai: {exc}"
            ) from exc

        return cls._model_instance

    def predict_properties(self, smiles: str) -> AdmetPredictionResult:
        """Predice propiedades ADMET para un SMILES individual."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles)
        smiles_value: str = normalized_smiles_list[0]

        try:
            model_instance: object = self._get_model()
            raw_prediction: object = cast(
                object,
                getattr(model_instance, "predict")(smiles=smiles_value),
            )
            normalized_predictions: dict[str, float] = self._normalize_predictions(
                raw_prediction
            )
            return AdmetPredictionResult(
                smiles=smiles_value,
                success=True,
                predictions=normalized_predictions,
                error_message=None,
            )
        except Exception as exc:  # noqa: BLE001
            return AdmetPredictionResult(
                smiles=smiles_value,
                success=False,
                predictions={},
                error_message=f"Error ejecutando ADMET-AI: {exc}",
            )

    def predict_properties_batch(
        self,
        smiles_input: SmilesInput,
    ) -> AdmetPredictionBatchResult:
        """Predice propiedades ADMET para múltiples SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles_input)
        results: list[AdmetPredictionResult] = [
            self.predict_properties(smiles_value)
            for smiles_value in normalized_smiles_list
        ]
        return AdmetPredictionBatchResult(results=results)

    def _normalize_predictions(self, raw_prediction: object) -> dict[str, float]:
        """Normaliza la salida de ADMET-AI a un diccionario de floats."""
        if not isinstance(raw_prediction, Mapping):
            raise RuntimeError(
                "ADMET-AI retornó un formato inesperado; se esperaba dict-like."
            )

        serialized_predictions: dict[str, float] = {}
        for raw_key, raw_value in raw_prediction.items():
            if not isinstance(raw_key, str):
                continue
            if isinstance(raw_value, bool):
                continue
            if isinstance(raw_value, int | float):
                serialized_predictions[raw_key] = float(raw_value)

        if len(serialized_predictions) == 0:
            raise RuntimeError("ADMET-AI no retornó propiedades numéricas utilizables.")

        return serialized_predictions


def predict_admet_properties(smiles: str) -> dict[str, object]:
    """Atajo funcional para predecir ADMET en una molécula."""
    return AdmetAiClient().predict_properties(smiles).to_dict()


def predict_admet_properties_batch(smiles_input: SmilesInput) -> dict[str, object]:
    """Atajo funcional para predecir ADMET en múltiples moléculas."""
    return AdmetAiClient().predict_properties_batch(smiles_input).to_dict()

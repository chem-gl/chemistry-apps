"""
# brsascore/client.py

Cliente de alto nivel para calcular BR-SA score usando el paquete vendorizado BRSAScore.
Expone API para un SMILES o lista de SMILES, análogo a libs/ambit/client.py.

El paquete BRSAScore está vendorizado en libs/brsascore_src/. Este módulo ajusta
sys.path en tiempo de importación para resolverlo sin instalación en site-packages.

Uso:
    from libs.brsascore.client import predict_brsa_score, predict_brsa_scores

    single = predict_brsa_score("CCO")
    batch = predict_brsa_scores(["CCO", "c1ccccc1"])
"""

from __future__ import annotations

import sys
from pathlib import Path

from ..runtime_support import SmilesInput, normalize_smiles_input
from .models import BrsaBatchResult, BrsaScoreResult

# Añade el directorio padre de BRSAScore al sys.path para importar el paquete vendorizado.
# Esto es equivalente a tenerlo instalado en site-packages pero de forma controlada.
_BRSASCORE_SRC_PATH: Path = Path(__file__).resolve().parent.parent / "brsascore_src"
if str(_BRSASCORE_SRC_PATH) not in sys.path:
    sys.path.insert(0, str(_BRSASCORE_SRC_PATH))


class BrsaScoreClient:
    """Cliente para calcular BR-SA score usando la librería vendorizada BRSAScore."""

    def predict_sa_score(self, smiles: str) -> BrsaScoreResult:
        """Calcula BR-SA score para un solo SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles)
        return self._run_single_smiles(normalized_smiles_list[0])

    def predict_sa_scores(self, smiles_input: SmilesInput) -> BrsaBatchResult:
        """Calcula BR-SA score para una lista de SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles_input)
        return BrsaBatchResult(
            results=[self._run_single_smiles(s) for s in normalized_smiles_list]
        )

    def _run_single_smiles(self, smiles_value: str) -> BrsaScoreResult:
        """Ejecuta BRSAScore para un SMILES y retorna el score."""
        try:
            from BRSAScore import SAScorer
            from rdkit.Chem import MolFromSmiles

            mol = MolFromSmiles(smiles_value)
            if mol is None:
                return BrsaScoreResult(
                    smiles=smiles_value,
                    sa_score=None,
                    success=False,
                    error_message=f"SMILES inválido para BRSAScore: {smiles_value}",
                )

            scorer = SAScorer()
            # BRSAScore recibe SMILES (str); no acepta RDKit Mol como entrada.
            score, _ = scorer.calculate_score(smiles_value)

            return BrsaScoreResult(
                smiles=smiles_value,
                sa_score=float(score),
                success=True,
            )
        except Exception as exc:  # noqa: BLE001
            return BrsaScoreResult(
                smiles=smiles_value,
                sa_score=None,
                success=False,
                error_message=f"Error ejecutando BRSAScore: {exc}",
            )


def predict_brsa_score(smiles: str) -> dict[str, str | float | bool | None]:
    """Atajo funcional para BR-SA score de una sola molécula."""
    return BrsaScoreClient().predict_sa_score(smiles).to_dict()


def predict_brsa_scores(
    smiles_input: SmilesInput,
) -> dict[str, object]:
    """Atajo funcional para BR-SA score de múltiples moléculas."""
    return BrsaScoreClient().predict_sa_scores(smiles_input).to_dict()

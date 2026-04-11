"""
# rdkit_sa/client.py

Cliente de alto nivel para calcular SA score usando RDKit Contrib SA_Score
(sascorer.py). Calcula la accesibilidad sintética directamente desde RDKit
sin procesos externos, análogo a libs/ambit/client.py.

Uso:
    from libs.rdkit_sa.client import predict_rdkit_sa_score, predict_rdkit_sa_scores

    single = predict_rdkit_sa_score("CCO")
    batch = predict_rdkit_sa_scores(["CCO", "c1ccccc1"])
"""

from __future__ import annotations

from ..runtime_support import SmilesInput, normalize_smiles_input
from .models import RdkitSaBatchResult, RdkitSaScoreResult


class RdkitSaClient:
    """Cliente para calcular SA score usando rdkit.Contrib.SA_Score.sascorer."""

    def predict_sa_score(self, smiles: str) -> RdkitSaScoreResult:
        """Calcula SA score nativo de RDKit para un solo SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles)
        return self._run_single_smiles(normalized_smiles_list[0])

    def predict_sa_scores(self, smiles_input: SmilesInput) -> RdkitSaBatchResult:
        """Calcula SA score nativo de RDKit para una lista de SMILES."""
        normalized_smiles_list: list[str] = normalize_smiles_input(smiles_input)
        return RdkitSaBatchResult(
            results=[self._run_single_smiles(s) for s in normalized_smiles_list]
        )

    def _run_single_smiles(self, smiles_value: str) -> RdkitSaScoreResult:
        """Ejecuta RDKit SA_Score para un SMILES y retorna el score."""
        try:
            # rdkit.Contrib.SA_Score está disponible en rdkit >= 2021.03
            from rdkit.Chem import MolFromSmiles
            from rdkit.Contrib.SA_Score import sascorer

            mol = MolFromSmiles(smiles_value)
            if mol is None:
                return RdkitSaScoreResult(
                    smiles=smiles_value,
                    sa_score=None,
                    success=False,
                    error_message=(
                        f"SMILES inválido para RDKit SA Score: {smiles_value}"
                    ),
                )

            score: float = sascorer.calculateScore(mol)

            return RdkitSaScoreResult(
                smiles=smiles_value,
                sa_score=float(score),
                success=True,
            )
        except Exception as exc:
            return RdkitSaScoreResult(
                smiles=smiles_value,
                sa_score=None,
                success=False,
                error_message=f"Error ejecutando RDKit SA Score: {exc}",
            )


def predict_rdkit_sa_score(smiles: str) -> dict[str, str | float | bool | None]:
    """Atajo funcional para SA score nativo de RDKit de una sola molécula."""
    return RdkitSaClient().predict_sa_score(smiles).to_dict()


def predict_rdkit_sa_scores(
    smiles_input: SmilesInput,
) -> dict[str, object]:
    """Atajo funcional para SA score nativo de RDKit de múltiples moléculas."""
    return RdkitSaClient().predict_sa_scores(smiles_input).to_dict()

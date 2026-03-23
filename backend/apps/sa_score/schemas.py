"""schemas.py: Serializers DRF para la app SA Score.

Objetivo del archivo:
- Definir contratos HTTP de entrada y salida con validación y documentación OpenAPI.
- El serializer de creación acepta un SMILES o lista de SMILES y una lista de métodos.

Cómo se usa:
- `routers.py` usa SaScoreJobCreateSerializer para validar el request de creación.
- `routers.py` usa SaScoreJobResponseSerializer para serializar la respuesta de consulta.
"""

from __future__ import annotations

from typing import cast

from apps.core.models import ScientificJob
from apps.core.types import JSONMap
from drf_spectacular.utils import extend_schema_field
from rdkit import Chem
from rest_framework import serializers

from .definitions import DEFAULT_ALGORITHM_VERSION, MAX_SMILES_PER_JOB, SA_SCORE_METHODS


class SaScoreJobCreateSerializer(serializers.Serializer):
    """Valida la creación de un job de SA score.

    Acepta `smiles` como string único o lista de strings.
    Acepta `methods` como lista de métodos válidos (ambit, brsa, rdkit).
    """

    smiles = serializers.ListField(
        child=serializers.CharField(max_length=4096),
        min_length=1,
        max_length=MAX_SMILES_PER_JOB,
        help_text=(
            f"Lista de SMILES a evaluar. Máximo {MAX_SMILES_PER_JOB}. "
            "Cada elemento debe ser un SMILES válido."
        ),
    )
    methods = serializers.ListField(
        child=serializers.ChoiceField(choices=list(SA_SCORE_METHODS)),
        min_length=1,
        default=list(SA_SCORE_METHODS),
        help_text=(
            "Métodos de SA score a calcular. "
            "Opciones: ambit, brsa, rdkit. Por defecto todos."
        ),
    )
    version = serializers.CharField(
        max_length=20,
        default=DEFAULT_ALGORITHM_VERSION,
        required=False,
        help_text="Versión del algoritmo. Por defecto la versión más reciente.",
    )

    def validate_smiles(self, value: list[str]) -> list[str]:
        """Elimina duplicados y valida compatibilidad química de cada SMILES."""
        cleaned_smiles: list[str] = []
        seen_smiles: set[str] = set()
        for raw_smiles in value:
            normalized_smiles: str = raw_smiles.strip()
            if normalized_smiles == "":
                continue
            if normalized_smiles in seen_smiles:
                continue
            if Chem.MolFromSmiles(normalized_smiles) is None:
                raise serializers.ValidationError(
                    f"SMILES no compatible con RDKit: {normalized_smiles}"
                )
            seen_smiles.add(normalized_smiles)
            cleaned_smiles.append(normalized_smiles)

        if len(cleaned_smiles) == 0:
            raise serializers.ValidationError(
                "La lista de SMILES no puede estar vacía después de normalizar."
            )
        return cleaned_smiles

    def validate_methods(self, value: list[str]) -> list[str]:
        """Elimina métodos duplicados preservando el orden canónico."""
        return list(dict.fromkeys(value))


class SaMoleculeResultSerializer(serializers.Serializer):
    """Serializa el resultado de SA score para una molécula individual."""

    smiles = serializers.CharField(read_only=True)
    ambit_sa = serializers.FloatField(
        read_only=True,
        allow_null=True,
        help_text="AMBIT-SA en porcentaje (0-100).",
    )
    brsa_sa = serializers.FloatField(
        read_only=True,
        allow_null=True,
        help_text="BR-SAScore convertido a escala AMBIT-SA (0-100).",
    )
    rdkit_sa = serializers.FloatField(
        read_only=True,
        allow_null=True,
        help_text="RDKit SA score convertido a escala AMBIT-SA (0-100).",
    )
    ambit_error = serializers.CharField(read_only=True, allow_null=True)
    brsa_error = serializers.CharField(read_only=True, allow_null=True)
    rdkit_error = serializers.CharField(read_only=True, allow_null=True)


class SaScoreResultsSerializer(serializers.Serializer):
    """Serializa el bloque completo de resultados de un job de SA score."""

    molecules = SaMoleculeResultSerializer(many=True, read_only=True)
    total = serializers.IntegerField(read_only=True)
    requested_methods = serializers.ListField(
        child=serializers.CharField(),
        read_only=True,
    )


class SaScoreJobResponseSerializer(serializers.ModelSerializer):
    """Serializa un job de SA score completo incluyendo resultados y estado."""

    results = serializers.SerializerMethodField()

    class Meta:
        model = ScientificJob
        fields = [
            "id",
            "status",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "parameters",
            "results",
            "created_at",
            "updated_at",
        ]

    @extend_schema_field(SaScoreResultsSerializer)
    def get_results(self, obj: ScientificJob) -> dict | None:
        """Devuelve resultados deserializados o None si el job aún no completó."""
        if obj.results is None:
            return None
        results_payload: JSONMap = cast(JSONMap, obj.results)
        serializer = SaScoreResultsSerializer(results_payload)
        return serializer.data

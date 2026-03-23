"""schemas.py: Serializers DRF para Toxicity Properties Table.

Define validación de entrada y serialización tipada de resultados de job
para documentación OpenAPI y consumo del frontend.
"""

from __future__ import annotations

from typing import cast

from apps.core.models import ScientificJob
from apps.core.types import JSONMap
from drf_spectacular.utils import extend_schema_field
from rdkit import Chem
from rest_framework import serializers

from .definitions import DEFAULT_ALGORITHM_VERSION


class ToxicityJobCreateSerializer(serializers.Serializer):
    """Valida la creación de un job toxicológico por lista de SMILES."""

    smiles = serializers.ListField(
        child=serializers.CharField(max_length=4096),
        min_length=1,
        help_text=(
            "Lista de SMILES a evaluar. "
            "No se aplica límite de negocio; el procesamiento es por bloques internos."
        ),
    )
    version = serializers.CharField(
        max_length=20,
        default=DEFAULT_ALGORITHM_VERSION,
        required=False,
        help_text="Versión de algoritmo a persistir en el job.",
    )

    def validate_smiles(self, value: list[str]) -> list[str]:
        """Normaliza y valida compatibilidad de SMILES con RDKit."""
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
                "La lista de SMILES no puede quedar vacía tras normalizar."
            )
        return cleaned_smiles


class ToxicityMoleculeResultSerializer(serializers.Serializer):
    """Serializa una fila de la tabla de propiedades toxicológicas."""

    smiles = serializers.CharField(read_only=True)
    LD50_mgkg = serializers.FloatField(read_only=True, allow_null=True)
    mutagenicity = serializers.CharField(read_only=True, allow_null=True)
    ames_score = serializers.FloatField(read_only=True, allow_null=True)
    DevTox = serializers.CharField(read_only=True, allow_null=True)
    devtox_score = serializers.FloatField(read_only=True, allow_null=True)
    error_message = serializers.CharField(read_only=True, allow_null=True)


class ToxicityResultsSerializer(serializers.Serializer):
    """Serializa el bloque total de resultados del job toxicológico."""

    molecules = ToxicityMoleculeResultSerializer(many=True, read_only=True)
    total = serializers.IntegerField(read_only=True)
    scientific_references = serializers.ListField(
        child=serializers.CharField(),
        read_only=True,
    )


class ToxicityJobResponseSerializer(serializers.ModelSerializer):
    """Serializa un ScientificJob para la app Toxicity Properties."""

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

    @extend_schema_field(ToxicityResultsSerializer)
    def get_results(self, obj: ScientificJob) -> dict | None:
        """Deserializa resultados persistidos o retorna None si no existen."""
        if obj.results is None:
            return None
        results_payload: JSONMap = cast(JSONMap, obj.results)
        serializer = ToxicityResultsSerializer(results_payload)
        return serializer.data

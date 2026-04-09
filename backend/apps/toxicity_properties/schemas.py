"""schemas.py: Serializers DRF para Toxicity Properties Table.

Define validación de entrada y serialización tipada de resultados de job
para documentación OpenAPI y consumo del frontend.
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.models import ScientificJob
from apps.core.smiles_batch import normalize_named_smiles_entries
from apps.core.types import JSONMap

from .definitions import DEFAULT_ALGORITHM_VERSION


class ToxicityMoleculeInputSerializer(serializers.Serializer):
    """Serializa una fila de entrada name/smiles para Toxicity Properties."""

    name = serializers.CharField(required=False, allow_blank=True, max_length=4096)
    smiles = serializers.CharField(max_length=4096)


class ToxicityJobCreateSerializer(serializers.Serializer):
    """Valida la creación de un job toxicológico por lista de SMILES."""

    smiles = serializers.ListField(
        child=serializers.CharField(max_length=4096, allow_blank=True),
        min_length=1,
        required=False,
        write_only=True,
        help_text=(
            "Lista de SMILES a evaluar. "
            "No se aplica límite de negocio; el procesamiento es por bloques internos."
        ),
    )
    molecules = ToxicityMoleculeInputSerializer(
        many=True,
        required=False,
        help_text=(
            "Lista de moléculas con formato {name, smiles}. "
            "Si name se omite o queda vacío, se usa smiles como nombre."
        ),
    )
    version = serializers.CharField(
        max_length=20,
        default=DEFAULT_ALGORITHM_VERSION,
        required=False,
        help_text="Versión de algoritmo a persistir en el job.",
    )

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        """Normaliza la entrada a una lista única de moléculas name/smiles."""
        raw_smiles_list: list[str] | None = cast(list[str] | None, attrs.get("smiles"))
        raw_molecules: list[dict[str, object]] | None = cast(
            list[dict[str, object]] | None, attrs.get("molecules")
        )

        if raw_smiles_list is None and raw_molecules is None:
            raise serializers.ValidationError(
                {"molecules": "Debe enviar `molecules` o `smiles` para crear el job."}
            )

        try:
            attrs["molecules"] = normalize_named_smiles_entries(
                smiles_list=raw_smiles_list,
                molecule_entries=raw_molecules,
            )
        except ValueError as exc:
            raise serializers.ValidationError({"molecules": str(exc)}) from exc

        attrs.pop("smiles", None)
        return attrs


class ToxicityMoleculeResultSerializer(serializers.Serializer):
    """Serializa una fila de la tabla de propiedades toxicológicas."""

    name = serializers.CharField(read_only=True)
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

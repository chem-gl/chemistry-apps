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

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.models import ScientificJob
from apps.core.smiles_batch import normalize_named_smiles_entries
from apps.core.types import JSONMap

from .definitions import DEFAULT_ALGORITHM_VERSION, MAX_SMILES_PER_JOB, SA_SCORE_METHODS


class SaScoreMoleculeInputSerializer(serializers.Serializer):
    """Serializa una fila de entrada name/smiles para lotes de SA Score."""

    name = serializers.CharField(required=False, allow_blank=True, max_length=4096)
    smiles = serializers.CharField(max_length=4096)


class SaScoreJobCreateSerializer(serializers.Serializer):
    """Valida la creación de un job de SA score.

    Acepta `smiles` como string único o lista de strings.
    Acepta `methods` como lista de métodos válidos (ambit, brsa, rdkit).
    """

    smiles = serializers.ListField(
        child=serializers.CharField(max_length=4096, allow_blank=True),
        min_length=1,
        max_length=MAX_SMILES_PER_JOB,
        required=False,
        write_only=True,
        help_text=(
            f"Lista de SMILES a evaluar. Máximo {MAX_SMILES_PER_JOB}. "
            "Cada elemento debe ser un SMILES válido."
        ),
    )
    molecules = SaScoreMoleculeInputSerializer(
        many=True,
        required=False,
        help_text=(
            "Lista de moléculas con formato {name, smiles}. "
            "Si name se omite o queda vacío, se usa smiles como nombre."
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

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        """Normaliza el lote de entrada a una única lista de moléculas name/smiles."""
        raw_smiles_list: list[str] | None = cast(list[str] | None, attrs.get("smiles"))
        raw_molecules: list[dict[str, object]] | None = cast(
            list[dict[str, object]] | None, attrs.get("molecules")
        )

        if raw_smiles_list is None and raw_molecules is None:
            raise serializers.ValidationError(
                {"molecules": "Debe enviar `molecules` o `smiles` para crear el job."}
            )

        try:
            normalized_molecules = normalize_named_smiles_entries(
                smiles_list=raw_smiles_list,
                molecule_entries=raw_molecules,
            )
        except ValueError as exc:
            raise serializers.ValidationError({"molecules": str(exc)}) from exc

        if len(normalized_molecules) > MAX_SMILES_PER_JOB:
            raise serializers.ValidationError(
                {
                    "molecules": (
                        f"El lote excede el máximo permitido de {MAX_SMILES_PER_JOB} moléculas."
                    )
                }
            )

        attrs["molecules"] = normalized_molecules
        attrs.pop("smiles", None)
        return attrs

    def validate_methods(self, value: list[str]) -> list[str]:
        """Elimina métodos duplicados preservando el orden canónico."""
        return list(dict.fromkeys(value))


class SaMoleculeResultSerializer(serializers.Serializer):
    """Serializa el resultado de SA score para una molécula individual."""

    name = serializers.CharField(read_only=True)
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

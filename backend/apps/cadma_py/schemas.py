"""schemas.py: Serializers HTTP para CADMA Py.

Valida el alta de familias de referencia y la creación de jobs de comparación,
manteniendo el contrato OpenAPI alineado con la UI del frontend.
"""

from __future__ import annotations

from uuid import UUID

from rest_framework import serializers

from apps.core.models import ScientificJob


class CadmaPyJobCreateSerializer(serializers.Serializer):
    """Valida la creación de un job CADMA Py a partir de una familia y CSVs."""

    reference_library_id = serializers.CharField(max_length=80)
    project_label = serializers.CharField(
        required=False, allow_blank=True, max_length=160
    )
    combined_csv_text = serializers.CharField(required=False, allow_blank=True)
    smiles_csv_text = serializers.CharField(required=False, allow_blank=True)
    toxicity_csv_text = serializers.CharField(required=False, allow_blank=True)
    sa_csv_text = serializers.CharField(required=False, allow_blank=True)
    combined_file = serializers.FileField(required=False, allow_null=True)
    smiles_file = serializers.FileField(required=False, allow_null=True)
    toxicity_file = serializers.FileField(required=False, allow_null=True)
    sa_file = serializers.FileField(required=False, allow_null=True)
    source_configs_json = serializers.CharField(required=False, allow_blank=True)
    score_config_json = serializers.CharField(required=False, allow_blank=True)
    start_paused = serializers.BooleanField(required=False, default=False)

    def validate_reference_library_id(self, value: str) -> str:
        normalized_value = value.strip()
        if normalized_value in {"sample-neuro", "sample-rett"}:
            return normalized_value

        try:
            UUID(normalized_value)
        except ValueError as exc:
            raise serializers.ValidationError(
                "reference_library_id debe ser un UUID válido o una seed sample soportada."
            ) from exc
        return normalized_value

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        text_fields = (
            "combined_csv_text",
            "smiles_csv_text",
            "toxicity_csv_text",
            "sa_csv_text",
        )
        file_fields = ("combined_file", "smiles_file", "toxicity_file", "sa_file")
        has_text_input = any(
            str(attrs.get(field_name, "")).strip() != "" for field_name in text_fields
        )
        has_file_input = any(
            attrs.get(field_name) is not None for field_name in file_fields
        )
        has_guided_config = str(attrs.get("source_configs_json", "")).strip() != ""
        if not has_text_input and not has_file_input and not has_guided_config:
            raise serializers.ValidationError(
                "Debes proporcionar al menos un CSV para los compuestos candidatos."
            )
        return attrs


class CadmaReferenceLibraryWriteSerializer(serializers.Serializer):
    """Valida creación o actualización de una familia de referencia."""

    name = serializers.CharField(max_length=160)
    disease_name = serializers.CharField(max_length=160)
    description = serializers.CharField(required=False, allow_blank=True)
    paper_reference = serializers.CharField(
        required=False, allow_blank=True, max_length=300
    )
    paper_url = serializers.CharField(required=False, allow_blank=True, max_length=500)
    combined_csv_text = serializers.CharField(required=False, allow_blank=True)
    smiles_csv_text = serializers.CharField(required=False, allow_blank=True)
    toxicity_csv_text = serializers.CharField(required=False, allow_blank=True)
    sa_csv_text = serializers.CharField(required=False, allow_blank=True)
    combined_file = serializers.FileField(required=False, allow_null=True)
    smiles_file = serializers.FileField(required=False, allow_null=True)
    toxicity_file = serializers.FileField(required=False, allow_null=True)
    sa_file = serializers.FileField(required=False, allow_null=True)
    source_configs_json = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        text_fields = (
            "combined_csv_text",
            "smiles_csv_text",
            "toxicity_csv_text",
            "sa_csv_text",
        )
        file_fields = ("combined_file", "smiles_file", "toxicity_file", "sa_file")
        has_text_input = any(
            str(attrs.get(field_name, "")).strip() != "" for field_name in text_fields
        )
        has_file_input = any(
            attrs.get(field_name) is not None for field_name in file_fields
        )
        has_guided_config = str(attrs.get("source_configs_json", "")).strip() != ""
        if (
            self.partial
            and not has_text_input
            and not has_file_input
            and not has_guided_config
        ):
            return attrs

        if not has_text_input and not has_file_input and not has_guided_config:
            raise serializers.ValidationError(
                "Debes cargar CSVs del set de referencia para poder guardar la familia."
            )

        paper_reference = str(attrs.get("paper_reference", "")).strip()
        paper_url = str(attrs.get("paper_url", "")).strip()
        if paper_reference == "" and paper_url == "":
            raise serializers.ValidationError(
                "La familia de referencia necesita paper_reference o paper_url para trazabilidad."
            )
        return attrs


class CadmaReferenceLibraryResponseSerializer(serializers.Serializer):
    """Serializer de salida para una familia de referencia visible."""

    id = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    disease_name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    source_reference = serializers.CharField(read_only=True)
    group_id = serializers.IntegerField(read_only=True, allow_null=True)
    created_by_id = serializers.IntegerField(read_only=True, allow_null=True)
    created_by_name = serializers.CharField(read_only=True)
    editable = serializers.BooleanField(read_only=True)
    deletable = serializers.BooleanField(read_only=True)
    forkable = serializers.BooleanField(read_only=True)
    row_count = serializers.IntegerField(read_only=True)
    rows = serializers.JSONField(read_only=True)
    source_file_count = serializers.IntegerField(read_only=True)
    source_files = serializers.JSONField(read_only=True)
    paper_reference = serializers.CharField(read_only=True)
    paper_url = serializers.CharField(read_only=True)
    created_at = serializers.CharField(read_only=True)
    updated_at = serializers.CharField(read_only=True)


class CadmaReferenceSampleSerializer(serializers.Serializer):
    """Serializer de salida para datasets legacy disponibles."""

    key = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    disease_name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    row_count = serializers.IntegerField(read_only=True)
    source_note = serializers.CharField(read_only=True)


class CadmaReferenceSamplePreviewRowSerializer(serializers.Serializer):
    """Serializer con name + SMILES para vista previa de muestra legacy."""

    name = serializers.CharField(read_only=True)
    smiles = serializers.CharField(read_only=True)


class CadmaReferenceSampleImportSerializer(serializers.Serializer):
    """Valida la importación/copia de un dataset sample incluido en el repositorio."""

    sample_key = serializers.ChoiceField(choices=["neuro", "rett"])
    new_name = serializers.CharField(required=False, allow_blank=True, max_length=160)


class CadmaReferenceLibraryForkSerializer(serializers.Serializer):
    """Valida la copia explícita de una familia con nombre opcional."""

    new_name = serializers.CharField(required=False, allow_blank=True, max_length=160)


class CadmaReferenceRowPatchSerializer(serializers.Serializer):
    """Valida la edición parcial de una fila de referencia existente."""

    name = serializers.CharField(required=False, max_length=200)
    paper_reference = serializers.CharField(
        required=False, allow_blank=True, max_length=300
    )
    paper_url = serializers.CharField(required=False, allow_blank=True, max_length=500)
    evidence_note = serializers.CharField(
        required=False, allow_blank=True, max_length=1000
    )


class CadmaCompoundAddSerializer(serializers.Serializer):
    """Valida la adición de un compuesto nuevo a una familia existente."""

    smiles = serializers.CharField(max_length=2000)
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    paper_reference = serializers.CharField(
        required=False, allow_blank=True, max_length=300
    )
    paper_url = serializers.CharField(required=False, allow_blank=True, max_length=500)
    evidence_note = serializers.CharField(
        required=False, allow_blank=True, max_length=1000
    )
    toxicity_dt = serializers.FloatField(required=False, allow_null=True)
    toxicity_m = serializers.FloatField(required=False, allow_null=True)
    toxicity_ld50 = serializers.FloatField(required=False, allow_null=True)
    sa_score = serializers.FloatField(required=False, allow_null=True)


class CadmaCompoundRowResponseSerializer(serializers.Serializer):
    """Serializer de salida para una fila de compuesto individual."""

    name = serializers.CharField(read_only=True)
    smiles = serializers.CharField(read_only=True)
    MW = serializers.FloatField(read_only=True)
    logP = serializers.FloatField(read_only=True)
    MR = serializers.FloatField(read_only=True)
    AtX = serializers.FloatField(read_only=True)
    HBLA = serializers.FloatField(read_only=True)
    HBLD = serializers.FloatField(read_only=True)
    RB = serializers.FloatField(read_only=True)
    PSA = serializers.FloatField(read_only=True)
    DT = serializers.FloatField(read_only=True)
    M = serializers.FloatField(read_only=True)
    LD50 = serializers.FloatField(read_only=True)
    SA = serializers.FloatField(read_only=True)
    paper_reference = serializers.CharField(read_only=True)
    paper_url = serializers.CharField(read_only=True)
    evidence_note = serializers.CharField(read_only=True)


class CadmaLinkedJobSerializer(serializers.Serializer):
    """Serializer de salida para un job vinculado a una familia de referencia."""

    id = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    created_at = serializers.CharField(read_only=True)
    project_label = serializers.CharField(read_only=True)


class CadmaDeletionPreviewSerializer(serializers.Serializer):
    """Serializer de salida para la vista previa de eliminación de una familia."""

    library_id = serializers.CharField(read_only=True)
    library_name = serializers.CharField(read_only=True)
    linked_job_count = serializers.IntegerField(read_only=True)
    linked_jobs = CadmaLinkedJobSerializer(many=True, read_only=True)


class CadmaPyJobResponseSerializer(serializers.ModelSerializer):
    """Serializa un ScientificJob completo para CADMA Py."""

    class Meta:
        model = ScientificJob
        fields = (
            "id",
            "owner",
            "group",
            "plugin_name",
            "algorithm_version",
            "status",
            "parameters",
            "results",
            "error_trace",
            "progress_message",
            "progress_percentage",
            "created_at",
            "updated_at",
        )

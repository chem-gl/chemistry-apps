"""schemas.py: Contrato OpenAPI tipado para la app Marcus.

Objetivo del archivo:
- Validar create multipart y exponer respuesta estable de jobs Marcus.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import DEFAULT_ALGORITHM_VERSION


class MarcusArtifactDescriptorSerializer(serializers.Serializer):
    """Descriptor de archivo persistido en parámetros del job."""

    field_name = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=120)
    sha256 = serializers.CharField(max_length=64)
    size_bytes = serializers.IntegerField(min_value=0)


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job Marcus con multipart",
            value={
                "version": "1.0.0",
                "title": "Electron Transfer Path",
                "diffusion": True,
                "radius_reactant_1": 2.0,
                "radius_reactant_2": 2.4,
                "reaction_distance": 3.2,
                "reactant_1_file": "<binary .log>",
                "reactant_2_file": "<binary .log>",
                "product_1_adiabatic_file": "<binary .log>",
                "product_2_adiabatic_file": "<binary .log>",
                "product_1_vertical_file": "<binary .log>",
                "product_2_vertical_file": "<binary .log>",
            },
            request_only=True,
        )
    ]
)
class MarcusJobCreateSerializer(serializers.Serializer):
    """Serializer de entrada para jobs Marcus."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    title = serializers.CharField(max_length=160, default="Title")
    diffusion = serializers.BooleanField(default=False)
    radius_reactant_1 = serializers.FloatField(required=False, allow_null=True)
    radius_reactant_2 = serializers.FloatField(required=False, allow_null=True)
    reaction_distance = serializers.FloatField(required=False, allow_null=True)

    reactant_1_file = serializers.FileField(required=True, allow_null=False)
    reactant_2_file = serializers.FileField(required=True, allow_null=False)
    product_1_adiabatic_file = serializers.FileField(required=True, allow_null=False)
    product_2_adiabatic_file = serializers.FileField(required=True, allow_null=False)
    product_1_vertical_file = serializers.FileField(required=True, allow_null=False)
    product_2_vertical_file = serializers.FileField(required=True, allow_null=False)

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        """Valida campos requeridos por corrección difusiva opcional."""
        if not bool(attrs.get("diffusion", False)):
            return attrs

        for field_name in [
            "radius_reactant_1",
            "radius_reactant_2",
            "reaction_distance",
        ]:
            field_value = attrs.get(field_name)
            if field_value is None or float(field_value) <= 0.0:
                raise serializers.ValidationError(
                    {
                        field_name: "Campo obligatorio y mayor que cero cuando diffusion=true."
                    }
                )

        return attrs


class MarcusStructureSnapshotSerializer(serializers.Serializer):
    """Snapshot mínimo por estructura usada en modelo Marcus."""

    source_field = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255)
    scf_energy = serializers.FloatField()
    thermal_free_enthalpy = serializers.FloatField()
    temperature = serializers.FloatField()


class MarcusStructuresSerializer(serializers.Serializer):
    """Conjunto de estructuras obligatorias del cálculo Marcus."""

    reactant_1_file = MarcusStructureSnapshotSerializer()
    reactant_2_file = MarcusStructureSnapshotSerializer()
    product_1_adiabatic_file = MarcusStructureSnapshotSerializer()
    product_2_adiabatic_file = MarcusStructureSnapshotSerializer()
    product_1_vertical_file = MarcusStructureSnapshotSerializer()
    product_2_vertical_file = MarcusStructureSnapshotSerializer()


class MarcusResultMetadataSerializer(serializers.Serializer):
    """Metadatos de salida del cálculo Marcus."""

    model_name = serializers.CharField(max_length=120)
    source_library = serializers.CharField(max_length=120)
    units = serializers.DictField(child=serializers.CharField())
    input_artifact_count = serializers.IntegerField(min_value=0)


class MarcusResultSerializer(serializers.Serializer):
    """Resultado de cinética Marcus."""

    title = serializers.CharField(max_length=160)
    adiabatic_energy_kcal_mol = serializers.FloatField()
    adiabatic_energy_corrected_kcal_mol = serializers.FloatField()
    vertical_energy_kcal_mol = serializers.FloatField()
    reorganization_energy_kcal_mol = serializers.FloatField()
    barrier_kcal_mol = serializers.FloatField()
    rate_constant_tst = serializers.FloatField()
    rate_constant = serializers.FloatField()
    diffusion_applied = serializers.BooleanField()
    k_diff = serializers.FloatField(allow_null=True)
    temperature_k = serializers.FloatField()
    viscosity_pa_s = serializers.FloatField(allow_null=True)
    structures = MarcusStructuresSerializer()
    metadata = MarcusResultMetadataSerializer()


class MarcusParametersSerializer(serializers.Serializer):
    """Parámetros persistidos de entrada para jobs Marcus."""

    title = serializers.CharField(max_length=160)
    diffusion = serializers.BooleanField()
    radius_reactant_1 = serializers.FloatField(allow_null=True)
    radius_reactant_2 = serializers.FloatField(allow_null=True)
    reaction_distance = serializers.FloatField(allow_null=True)
    file_descriptors = MarcusArtifactDescriptorSerializer(many=True)


class MarcusJobResponseSerializer(serializers.ModelSerializer):
    """Serializer de salida para jobs de la app Marcus."""

    parameters = MarcusParametersSerializer()
    results = MarcusResultSerializer(allow_null=True, required=False)

    class Meta:
        model = ScientificJob
        fields = [
            "id",
            "job_hash",
            "plugin_name",
            "algorithm_version",
            "status",
            "cache_hit",
            "cache_miss",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "progress_event_index",
            "parameters",
            "results",
            "error_trace",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

"""schemas.py: Contrato OpenAPI tipado para la app Easy-rate.

Objetivo del archivo:
- Validar create multipart y exponer respuesta estable de jobs Easy-rate.

Cómo se usa:
- `routers.py` valida entrada con `EasyRateJobCreateSerializer`.
- Frontend consume `EasyRateJobResponseSerializer` como contrato principal.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import DEFAULT_ALGORITHM_VERSION, SOLVENT_CHOICES


class EasyRateArtifactDescriptorSerializer(serializers.Serializer):
    """Descriptor de archivo usado para trazabilidad en parámetros del job."""

    field_name = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=120)
    sha256 = serializers.CharField(max_length=64)
    size_bytes = serializers.IntegerField(min_value=0)


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job Easy-rate con multipart",
            value={
                "version": "2.0.0",
                "title": "Hydrogen Transfer Path",
                "reaction_path_degeneracy": 1.0,
                "cage_effects": True,
                "diffusion": True,
                "solvent": "Water",
                "radius_reactant_1": 2.1,
                "radius_reactant_2": 2.3,
                "reaction_distance": 2.8,
                "print_data_input": True,
                "reactant_1_file": "<binary .log>",
                "reactant_2_file": "<binary .log>",
                "transition_state_file": "<binary .log>",
                "product_1_file": "<binary .log>",
            },
            request_only=True,
            description=(
                "Create multipart que recibe archivos Gaussian y parámetros de cálculo "
                "en una sola petición para trazabilidad/reintento reproducible."
            ),
        )
    ]
)
class EasyRateJobCreateSerializer(serializers.Serializer):
    """Serializer de entrada para creación de jobs Easy-rate."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    title = serializers.CharField(max_length=160, default="Title")
    reaction_path_degeneracy = serializers.FloatField(min_value=1e-12, default=1.0)
    cage_effects = serializers.BooleanField(default=False)
    diffusion = serializers.BooleanField(default=False)
    solvent = serializers.ChoiceField(choices=SOLVENT_CHOICES, default="")
    custom_viscosity = serializers.FloatField(required=False, allow_null=True)
    radius_reactant_1 = serializers.FloatField(required=False, allow_null=True)
    radius_reactant_2 = serializers.FloatField(required=False, allow_null=True)
    reaction_distance = serializers.FloatField(required=False, allow_null=True)
    print_data_input = serializers.BooleanField(default=False)
    reactant_1_execution_index = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )
    reactant_2_execution_index = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )
    transition_state_execution_index = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )
    product_1_execution_index = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )
    product_2_execution_index = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )

    reactant_1_file = serializers.FileField(required=True, allow_null=False)
    reactant_2_file = serializers.FileField(required=True, allow_null=False)
    transition_state_file = serializers.FileField(required=True, allow_null=False)
    product_1_file = serializers.FileField(required=False, allow_null=True)
    product_2_file = serializers.FileField(required=False, allow_null=True)

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        """Aplica validaciones de completitud y restricciones de difusión."""
        reactant_1_file = attrs.get("reactant_1_file")
        reactant_2_file = attrs.get("reactant_2_file")
        product_1_file = attrs.get("product_1_file")
        product_2_file = attrs.get("product_2_file")

        if reactant_1_file is None:
            raise serializers.ValidationError(
                {"reactant_1_file": "reactant_1_file es obligatorio."}
            )

        if reactant_2_file is None:
            raise serializers.ValidationError(
                {"reactant_2_file": "reactant_2_file es obligatorio."}
            )

        if product_1_file is None and product_2_file is None:
            raise serializers.ValidationError(
                "Debe cargarse al menos un producto (product_1_file o product_2_file)."
            )

        diffusion_enabled: bool = bool(attrs.get("diffusion", False))
        if not diffusion_enabled:
            return attrs

        required_diffusion_fields: list[str] = [
            "radius_reactant_1",
            "radius_reactant_2",
            "reaction_distance",
        ]
        for field_name in required_diffusion_fields:
            field_value = attrs.get(field_name)
            if field_value is None or float(field_value) <= 0:
                raise serializers.ValidationError(
                    {
                        field_name: "Campo obligatorio y mayor que cero cuando diffusion=true."
                    }
                )

        solvent_value: str = str(attrs.get("solvent", "")).strip()
        if solvent_value == "":
            raise serializers.ValidationError(
                {"solvent": "solvent es obligatorio cuando diffusion=true."}
            )

        if solvent_value == "Other":
            custom_viscosity = attrs.get("custom_viscosity")
            if custom_viscosity is None or float(custom_viscosity) <= 0:
                raise serializers.ValidationError(
                    {
                        "custom_viscosity": (
                            "custom_viscosity es obligatorio y > 0 cuando solvent='Other'."
                        )
                    }
                )

        return attrs


class EasyRateStructureSnapshotSerializer(serializers.Serializer):
    """Snapshot termodinámico de una estructura parseada."""

    source_field = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255, allow_null=True)
    is_provided = serializers.BooleanField()
    execution_index = serializers.IntegerField(allow_null=True)
    available_execution_count = serializers.IntegerField(min_value=0)
    job_title = serializers.CharField(max_length=255, allow_null=True)
    checkpoint_file = serializers.CharField(max_length=255, allow_null=True)
    charge = serializers.IntegerField()
    multiplicity = serializers.IntegerField()
    free_energy = serializers.FloatField()
    thermal_enthalpy = serializers.FloatField()
    zero_point_energy = serializers.FloatField()
    scf_energy = serializers.FloatField()
    temperature = serializers.FloatField()
    negative_frequencies = serializers.IntegerField()
    imaginary_frequency = serializers.FloatField()
    normal_termination = serializers.BooleanField()
    is_opt_freq = serializers.BooleanField()


class EasyRateInspectionRequestSerializer(serializers.Serializer):
    """Serializer de inspección previa de un archivo Gaussian de Easy-rate."""

    source_field = serializers.ChoiceField(
        choices=(
            "reactant_1_file",
            "reactant_2_file",
            "transition_state_file",
            "product_1_file",
            "product_2_file",
        )
    )
    gaussian_file = serializers.FileField(required=True, allow_null=False)


class EasyRateInspectionExecutionSerializer(serializers.Serializer):
    """Resumen de una ejecución candidata detectada durante la inspección."""

    source_field = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255, allow_null=True)
    execution_index = serializers.IntegerField(min_value=0)
    job_title = serializers.CharField(max_length=255, allow_null=True)
    checkpoint_file = serializers.CharField(max_length=255, allow_null=True)
    charge = serializers.IntegerField()
    multiplicity = serializers.IntegerField()
    free_energy = serializers.FloatField(allow_null=True)
    thermal_enthalpy = serializers.FloatField(allow_null=True)
    zero_point_energy = serializers.FloatField(allow_null=True)
    scf_energy = serializers.FloatField(allow_null=True)
    temperature = serializers.FloatField(allow_null=True)
    negative_frequencies = serializers.IntegerField(min_value=0)
    imaginary_frequency = serializers.FloatField(allow_null=True)
    normal_termination = serializers.BooleanField()
    is_opt_freq = serializers.BooleanField()
    is_valid_for_role = serializers.BooleanField()
    validation_errors = serializers.ListField(child=serializers.CharField())


class EasyRateInspectionResponseSerializer(serializers.Serializer):
    """Resultado agregado de la inspección previa de un archivo Easy-rate."""

    source_field = serializers.CharField(max_length=80)
    original_filename = serializers.CharField(max_length=255, allow_null=True)
    parse_errors = serializers.ListField(child=serializers.CharField())
    execution_count = serializers.IntegerField(min_value=0)
    default_execution_index = serializers.IntegerField(allow_null=True)
    executions = EasyRateInspectionExecutionSerializer(many=True)


class EasyRateResultMetadataSerializer(serializers.Serializer):
    """Metadatos de trazabilidad de salida Easy-rate."""

    model_name = serializers.CharField(max_length=120)
    source_library = serializers.CharField(max_length=120)
    units = serializers.DictField(child=serializers.CharField())
    input_artifact_count = serializers.IntegerField(min_value=0)


class EasyRateStructuresSerializer(serializers.Serializer):
    """Conjunto de estructuras normalizadas usadas por Easy-rate."""

    reactant_1_file = EasyRateStructureSnapshotSerializer()
    reactant_2_file = EasyRateStructureSnapshotSerializer()
    transition_state_file = EasyRateStructureSnapshotSerializer()
    product_1_file = EasyRateStructureSnapshotSerializer()
    product_2_file = EasyRateStructureSnapshotSerializer()


class EasyRateResultSerializer(serializers.Serializer):
    """Resultado científico de Easy-rate con métricas principales."""

    title = serializers.CharField(max_length=160)
    rate_constant = serializers.FloatField(allow_null=True)
    rate_constant_tst = serializers.FloatField(allow_null=True)
    rate_constant_diffusion_corrected = serializers.FloatField(allow_null=True)
    k_diff = serializers.FloatField(allow_null=True)
    gibbs_reaction_kcal_mol = serializers.FloatField()
    gibbs_activation_kcal_mol = serializers.FloatField()
    enthalpy_reaction_kcal_mol = serializers.FloatField()
    enthalpy_activation_kcal_mol = serializers.FloatField()
    zpe_reaction_kcal_mol = serializers.FloatField()
    zpe_activation_kcal_mol = serializers.FloatField()
    tunnel_u = serializers.FloatField(allow_null=True)
    tunnel_alpha_1 = serializers.FloatField(allow_null=True)
    tunnel_alpha_2 = serializers.FloatField(allow_null=True)
    tunnel_g = serializers.FloatField(allow_null=True)
    kappa_tst = serializers.FloatField()
    temperature_k = serializers.FloatField()
    imaginary_frequency_cm1 = serializers.FloatField()
    delta_n_reaction = serializers.IntegerField()
    delta_n_transition = serializers.IntegerField()
    warn_negative_activation = serializers.BooleanField()
    cage_effects_applied = serializers.BooleanField()
    diffusion_applied = serializers.BooleanField()
    solvent_used = serializers.CharField(max_length=40)
    viscosity_pa_s = serializers.FloatField(allow_null=True)
    reaction_path_degeneracy = serializers.FloatField()
    structures = EasyRateStructuresSerializer()
    metadata = EasyRateResultMetadataSerializer()


class EasyRateParametersSerializer(serializers.Serializer):
    """Parámetros persistidos de entrada de un job Easy-rate."""

    title = serializers.CharField(max_length=160)
    reaction_path_degeneracy = serializers.FloatField()
    cage_effects = serializers.BooleanField()
    diffusion = serializers.BooleanField()
    solvent = serializers.CharField(max_length=40)
    custom_viscosity = serializers.FloatField(allow_null=True)
    radius_reactant_1 = serializers.FloatField(allow_null=True)
    radius_reactant_2 = serializers.FloatField(allow_null=True)
    reaction_distance = serializers.FloatField(allow_null=True)
    print_data_input = serializers.BooleanField()
    reactant_1_execution_index = serializers.IntegerField(allow_null=True)
    reactant_2_execution_index = serializers.IntegerField(allow_null=True)
    transition_state_execution_index = serializers.IntegerField(allow_null=True)
    product_1_execution_index = serializers.IntegerField(allow_null=True)
    product_2_execution_index = serializers.IntegerField(allow_null=True)
    file_descriptors = EasyRateArtifactDescriptorSerializer(many=True)


class EasyRateJobResponseSerializer(serializers.ModelSerializer):
    """Serializer de salida para jobs de la app Easy-rate."""

    parameters = EasyRateParametersSerializer()
    results = EasyRateResultSerializer(allow_null=True, required=False)

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

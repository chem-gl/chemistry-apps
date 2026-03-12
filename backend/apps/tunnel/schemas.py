"""schemas.py: Contrato OpenAPI tipado para la app Tunnel.

Objetivo del archivo:
- Definir request/response estrictos y ejemplos realistas para efecto túnel.

Cómo se usa:
- `routers.py` valida entradas con `TunnelJobCreateSerializer`.
- El serializer de respuesta expone una estructura estable para frontend.
"""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import DEFAULT_ALGORITHM_VERSION, MAX_INPUT_CHANGE_EVENTS


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job Tunnel con trazabilidad de cambios",
            value={
                "version": "2.0.0",
                "reaction_barrier_zpe": 3.5,
                "imaginary_frequency": 625.0,
                "reaction_energy_zpe": -8.2,
                "temperature": 298.15,
                "input_change_events": [
                    {
                        "field_name": "reaction_barrier_zpe",
                        "previous_value": 0.0,
                        "new_value": 3.5,
                        "changed_at": "2026-03-12T10:01:10.000Z",
                    },
                    {
                        "field_name": "imaginary_frequency",
                        "previous_value": 0.0,
                        "new_value": 625.0,
                        "changed_at": "2026-03-12T10:01:19.000Z",
                    },
                ],
            },
            request_only=True,
            description=(
                "Calcula el efecto túnel con teoría de barrera de Eckart asimétrica y "
                "registra eventos de edición de entradas para auditoría."
            ),
        )
    ]
)
class TunnelJobCreateSerializer(serializers.Serializer):
    """Valida parámetros de creación para jobs de efecto túnel."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    reaction_barrier_zpe = serializers.FloatField(
        help_text="Reaction barrier ZPE en kcal/mol.",
    )
    imaginary_frequency = serializers.FloatField(
        help_text="Imaginary frequency en cm^-1 (sin signo negativo).",
    )
    reaction_energy_zpe = serializers.FloatField(
        help_text="Reaction energy ZPE en kcal/mol.",
    )
    temperature = serializers.FloatField(help_text="Temperatura en Kelvin.")
    input_change_events = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        max_length=MAX_INPUT_CHANGE_EVENTS,
        help_text="Eventos de modificación de entradas capturados en frontend.",
    )

    def validate(
        self,
        attrs: dict[str, str | float | list[dict[str, object]]],
    ) -> dict[str, str | float | list[dict[str, object]]]:
        """Aplica reglas de validación física mínimas para Tunnel."""
        frequency_value: float = float(attrs["imaginary_frequency"])
        if frequency_value <= 0:
            raise serializers.ValidationError(
                {
                    "imaginary_frequency": (
                        "imaginary_frequency debe ser mayor que cero y sin signo negativo."
                    )
                }
            )

        temperature_value: float = float(attrs["temperature"])
        if temperature_value <= 0:
            raise serializers.ValidationError(
                {"temperature": "temperature debe ser mayor que cero."}
            )

        barrier_value: float = float(attrs["reaction_barrier_zpe"])
        if barrier_value <= 0:
            raise serializers.ValidationError(
                {
                    "reaction_barrier_zpe": (
                        "reaction_barrier_zpe debe ser mayor que cero."
                    )
                }
            )

        return attrs


class TunnelInputChangeEventSerializer(serializers.Serializer):
    """Evento individual de modificación de entradas."""

    field_name = serializers.CharField(max_length=100)
    previous_value = serializers.FloatField()
    new_value = serializers.FloatField()
    changed_at = serializers.CharField(max_length=80)


class TunnelParametersSerializer(serializers.Serializer):
    """Parámetros persistidos de entrada para un job Tunnel."""

    reaction_barrier_zpe = serializers.FloatField()
    imaginary_frequency = serializers.FloatField()
    reaction_energy_zpe = serializers.FloatField()
    temperature = serializers.FloatField()
    input_change_events = TunnelInputChangeEventSerializer(many=True)


class TunnelMetadataSerializer(serializers.Serializer):
    """Metadatos técnicos de resultado Tunnel."""

    model_name = serializers.CharField(max_length=120)
    source_library = serializers.CharField(max_length=120)
    units = serializers.DictField(child=serializers.CharField())
    input_event_count = serializers.IntegerField(min_value=0)


class TunnelResultSerializer(serializers.Serializer):
    """Resultado tipado del cálculo Tunnel."""

    u = serializers.FloatField(help_text="Factor adimensional U.")
    alpha_1 = serializers.FloatField(help_text="Parámetro Alpha 1.")
    alpha_2 = serializers.FloatField(help_text="Parámetro Alpha 2.")
    g = serializers.FloatField(help_text="Valor G integrado para corrección túnel.")
    kappa_tst = serializers.FloatField(
        help_text="Factor de corrección túnel respecto al término clásico exp(-U).",
    )
    metadata = TunnelMetadataSerializer()


class TunnelJobResponseSerializer(serializers.ModelSerializer):
    """Respuesta estable para jobs de la app Tunnel."""

    parameters = TunnelParametersSerializer()
    results = TunnelResultSerializer(allow_null=True, required=False)

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

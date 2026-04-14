"""schemas.py: Contrato OpenAPI tipado para la app molar_fractions.

Objetivo del archivo:
- Definir request/response estrictos y ejemplos realistas de fracciones molares.

Cómo se usa:
- `routers.py` valida entradas con `MolarFractionsJobCreateSerializer`.
- El serializer de respuesta documenta estructura estable para frontend.
"""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import (
    DEFAULT_ALGORITHM_VERSION,
    DEFAULT_INITIAL_CHARGE,
    DEFAULT_LABEL,
    MAX_PH_POINTS,
    MAX_PKA_VALUES,
    MIN_PKA_VALUES,
)

PH_MODE_CHOICES: list[tuple[str, str]] = [
    ("single", "single"),
    ("range", "range"),
]


class InitialChargeField(serializers.CharField):
    """Normaliza la carga inicial permitiendo q o enteros."""

    def to_internal_value(self, data: object) -> int | str:
        raw_value: str = str(data).strip()
        if raw_value == "q":
            return "q"

        try:
            return int(raw_value)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError(
                "initial_charge debe ser un entero o el string 'q'."
            ) from exc

    def to_representation(self, value: object) -> int | str:
        if value == "q":
            return "q"
        return int(value)


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job molar fractions por rango",
            value={
                "version": "1.0.0",
                "pka_values": [2.2, 7.2, 12.3],
                "initial_charge": "q",
                "label": "A",
                "ph_mode": "range",
                "ph_min": 0.0,
                "ph_max": 14.0,
                "ph_step": 1.0,
            },
            request_only=True,
            description="Calcula fracciones f0..f3 desde pH 0 hasta 14 con paso 1.",
        ),
        OpenApiExample(
            "Crear job molar fractions en un solo pH",
            value={
                "version": "1.0.0",
                "pka_values": [4.75],
                "initial_charge": -1,
                "label": "Ac",
                "ph_mode": "single",
                "ph_value": 7.4,
            },
            request_only=True,
            description="Calcula fracciones en un único punto de pH.",
        ),
    ]
)
class MolarFractionsJobCreateSerializer(serializers.Serializer):
    """Valida parámetros de creación para jobs de fracciones molares."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    pka_values = serializers.ListField(
        child=serializers.FloatField(),
        min_length=MIN_PKA_VALUES,
        max_length=MAX_PKA_VALUES,
        help_text="Lista de pKa en el orden químico definido por el usuario.",
    )
    initial_charge = InitialChargeField(
        default=DEFAULT_INITIAL_CHARGE,
        help_text="Carga de la especie máximamente protonada. Acepta entero o 'q'.",
    )
    label = serializers.CharField(
        max_length=20,
        default=DEFAULT_LABEL,
        help_text="Etiqueta base de la especie, por ejemplo A o EDA.",
    )
    ph_mode = serializers.ChoiceField(
        choices=PH_MODE_CHOICES,
        help_text="Modo de cálculo: single para un pH o range para barrido.",
    )
    ph_value = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Valor de pH cuando ph_mode=single.",
    )
    ph_min = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="pH inicial para ph_mode=range.",
    )
    ph_max = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="pH final para ph_mode=range.",
    )
    ph_step = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Incremento de pH para ph_mode=range.",
    )

    def validate(
        self,
        attrs: dict[str, str | float | list[float] | None],
    ) -> dict[str, str | float | list[float] | None]:
        """Aplica reglas de coherencia entre modo single/range y límites."""
        pka_values: list[float] = [float(value) for value in attrs["pka_values"]]
        if len(pka_values) < MIN_PKA_VALUES or len(pka_values) > MAX_PKA_VALUES:
            raise serializers.ValidationError(
                {
                    "pka_values": (
                        "Se requieren entre "
                        f"{MIN_PKA_VALUES} y {MAX_PKA_VALUES} valores pKa."
                    )
                }
            )

        label_value: str = str(attrs.get("label", DEFAULT_LABEL)).strip()
        if label_value == "":
            raise serializers.ValidationError({"label": "label no puede estar vacío."})
        attrs["label"] = label_value

        mode_value: str = str(attrs.get("ph_mode", ""))

        if mode_value == "single":
            ph_value = attrs.get("ph_value")
            if ph_value is None:
                raise serializers.ValidationError(
                    {"ph_value": "ph_value es obligatorio cuando ph_mode=single."}
                )
            return attrs

        ph_min_value = attrs.get("ph_min")
        ph_max_value = attrs.get("ph_max")
        ph_step_value = attrs.get("ph_step")

        missing_fields: dict[str, str] = {}
        if ph_min_value is None:
            missing_fields["ph_min"] = "ph_min es obligatorio cuando ph_mode=range."
        if ph_max_value is None:
            missing_fields["ph_max"] = "ph_max es obligatorio cuando ph_mode=range."
        if ph_step_value is None:
            missing_fields["ph_step"] = "ph_step es obligatorio cuando ph_mode=range."
        if len(missing_fields) > 0:
            raise serializers.ValidationError(missing_fields)

        normalized_step: float = float(ph_step_value)
        if normalized_step <= 0:
            raise serializers.ValidationError(
                {"ph_step": "ph_step debe ser mayor que cero."}
            )

        normalized_min: float = float(ph_min_value)
        normalized_max: float = float(ph_max_value)
        span_value: float = abs(normalized_max - normalized_min)
        estimated_points: int = int(span_value / normalized_step) + 1
        if estimated_points > MAX_PH_POINTS:
            raise serializers.ValidationError(
                {
                    "ph_step": (
                        f"La malla de pH excede el máximo permitido de {MAX_PH_POINTS} "
                        "puntos."
                    )
                }
            )

        return attrs


class MolarFractionsParametersSerializer(serializers.Serializer):
    """Estructura persistida de parámetros de entrada del job."""

    pka_values = serializers.ListField(
        child=serializers.FloatField(),
        min_length=MIN_PKA_VALUES,
        max_length=MAX_PKA_VALUES,
    )
    initial_charge = InitialChargeField(default=DEFAULT_INITIAL_CHARGE)
    label = serializers.CharField(max_length=20, default=DEFAULT_LABEL)
    ph_mode = serializers.ChoiceField(choices=PH_MODE_CHOICES)
    ph_value = serializers.FloatField(required=False, allow_null=True)
    ph_min = serializers.FloatField(required=False, allow_null=True)
    ph_max = serializers.FloatField(required=False, allow_null=True)
    ph_step = serializers.FloatField(required=False, allow_null=True)


class MolarFractionRowSerializer(serializers.Serializer):
    """Fila de tabla de fracciones para un pH específico."""

    ph = serializers.FloatField(help_text="Valor de pH evaluado.")
    fractions = serializers.ListField(
        child=serializers.FloatField(),
        help_text="Fracciones molares f0..fn en el orden de especies.",
    )
    sum_fraction = serializers.FloatField(
        help_text="Suma de fracciones para verificación numérica.",
    )


class MolarFractionsMetadataSerializer(serializers.Serializer):
    """Metadatos técnicos del barrido de fracciones molares."""

    pka_values = serializers.ListField(child=serializers.FloatField())
    initial_charge = InitialChargeField(default=DEFAULT_INITIAL_CHARGE)
    label = serializers.CharField(max_length=20, default=DEFAULT_LABEL)
    ph_mode = serializers.ChoiceField(choices=PH_MODE_CHOICES)
    ph_min = serializers.FloatField()
    ph_max = serializers.FloatField()
    ph_step = serializers.FloatField()
    total_species = serializers.IntegerField(min_value=2)
    total_points = serializers.IntegerField(min_value=1)


class MolarFractionsResultSerializer(serializers.Serializer):
    """Resultado tipado del plugin de fracciones molares."""

    species_labels = serializers.ListField(
        child=serializers.CharField(max_length=20),
        help_text="Etiquetas formateadas de especies ácido-base.",
    )
    rows = MolarFractionRowSerializer(many=True)
    metadata = MolarFractionsMetadataSerializer()


class MolarFractionsJobResponseSerializer(serializers.ModelSerializer):
    """Respuesta estable para jobs de molar_fractions."""

    parameters = MolarFractionsParametersSerializer()
    results = MolarFractionsResultSerializer(allow_null=True, required=False)

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

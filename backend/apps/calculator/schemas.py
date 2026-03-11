"""schemas.py: Contratos estrictos OpenAPI para jobs de calculadora."""

from apps.core.models import ScientificJob
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .definitions import DEFAULT_ALGORITHM_VERSION

CALCULATOR_OPERATION_CHOICES: list[tuple[str, str]] = [
    ("add", "add"),
    ("sub", "sub"),
    ("mul", "mul"),
    ("div", "div"),
    ("pow", "pow"),
    ("factorial", "factorial"),
]


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job calculadora potencia",
            value={"version": "1.0.0", "op": "pow", "a": 2.0, "b": 8.0},
            request_only=True,
            description="Contrato estricto para potencia: resultado 2^8.",
        ),
        OpenApiExample(
            "Crear job calculadora factorial",
            value={"version": "1.0.0", "op": "factorial", "a": 5.0},
            request_only=True,
            description="Contrato estricto para factorial: solo usa el campo a.",
        ),
        OpenApiExample(
            "Crear job calculadora básico",
            value={"version": "1.0.0", "op": "add", "a": 5.0, "b": 3.0},
            request_only=True,
            description="Contrato estricto para crear un job de calculadora.",
        ),
    ]
)
class CalculatorJobCreateSerializer(serializers.Serializer):
    """Define parámetros estrictos para crear un job de calculadora."""

    version = serializers.CharField(
        max_length=50,
        default=DEFAULT_ALGORITHM_VERSION,
        help_text="Versión del algoritmo calculadora.",
    )
    op = serializers.ChoiceField(
        choices=CALCULATOR_OPERATION_CHOICES,
        help_text="Operación aritmética a ejecutar.",
    )
    a = serializers.FloatField(help_text="Primer operando numérico.")
    b = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text=(
            "Segundo operando numérico. Es obligatorio para add/sub/mul/div/pow "
            "y no debe enviarse para factorial."
        ),
    )

    def validate(
        self, attrs: dict[str, str | float | None]
    ) -> dict[str, str | float | None]:
        """Aplica reglas de contrato estricto para factorial y operaciones binarias."""
        operation_name: str = str(attrs.get("op", ""))
        second_operand: str | float | None = attrs.get("b")

        if operation_name == "factorial":
            if second_operand is not None:
                raise serializers.ValidationError(
                    {"b": "El campo b no está permitido para la operación factorial."}
                )

            first_operand: float = float(attrs["a"])
            if first_operand < 0 or not first_operand.is_integer():
                raise serializers.ValidationError(
                    {"a": "Para factorial, a debe ser un entero no negativo."}
                )
            return attrs

        if second_operand is None:
            raise serializers.ValidationError(
                {"b": "El campo b es obligatorio para operaciones binarias."}
            )

        return attrs


class CalculatorParametersSerializer(serializers.Serializer):
    """Estructura de parámetros persistidos para el job calculadora."""

    op = serializers.ChoiceField(choices=CALCULATOR_OPERATION_CHOICES)
    a = serializers.FloatField(
        help_text="Primer operando almacenado para trazabilidad."
    )
    b = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Segundo operando cuando aplica; ausente o nulo para factorial.",
    )


class CalculatorResultMetadataSerializer(serializers.Serializer):
    """Metadatos de trazabilidad del resultado de calculadora."""

    operation_used = serializers.ChoiceField(
        choices=CALCULATOR_OPERATION_CHOICES,
        help_text="Operación utilizada por el plugin para obtener el resultado.",
    )
    operand_a = serializers.FloatField(help_text="Valor de entrada del operando a.")
    operand_b = serializers.FloatField(
        allow_null=True,
        help_text="Valor de entrada del operando b cuando aplica.",
    )


class CalculatorResultSerializer(serializers.Serializer):
    """Resultado estricto del plugin calculadora."""

    final_result = serializers.FloatField()
    metadata = CalculatorResultMetadataSerializer()


class CalculatorJobResponseSerializer(serializers.ModelSerializer):
    """Respuesta tipada para jobs de calculadora consumibles por frontend."""

    parameters = CalculatorParametersSerializer()
    results = CalculatorResultSerializer(allow_null=True, required=False)

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
            "parameters",
            "results",
            "error_trace",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

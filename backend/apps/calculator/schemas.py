"""schemas.py: Contratos estrictos OpenAPI para jobs de calculadora."""

from apps.core.models import ScientificJob
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .definitions import DEFAULT_ALGORITHM_VERSION


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job calculadora",
            value={"version": "1.0.0", "op": "add", "a": 5.0, "b": 3.0},
            request_only=True,
            description="Contrato estricto para crear un job de calculadora.",
        )
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
        choices=[("add", "add"), ("sub", "sub"), ("mul", "mul"), ("div", "div")],
        help_text="Operación aritmética a ejecutar.",
    )
    a = serializers.FloatField(help_text="Primer operando numérico.")
    b = serializers.FloatField(help_text="Segundo operando numérico.")


class CalculatorParametersSerializer(serializers.Serializer):
    """Estructura de parámetros persistidos para el job calculadora."""

    op = serializers.ChoiceField(
        choices=[("add", "add"), ("sub", "sub"), ("mul", "mul"), ("div", "div")]
    )
    a = serializers.FloatField()
    b = serializers.FloatField()


class CalculatorResultMetadataSerializer(serializers.Serializer):
    """Metadatos de trazabilidad del resultado de calculadora."""

    operation_used = serializers.ChoiceField(
        choices=[("add", "add"), ("sub", "sub"), ("mul", "mul"), ("div", "div")]
    )
    operand_a = serializers.FloatField()
    operand_b = serializers.FloatField()


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

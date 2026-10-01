"""schemas.py: Contrato OpenAPI tipado para la app Server Calc.

Objetivo del archivo:
- Definir request/response estrictos y ejemplos realistas para la suma remota.

Cómo se usa:
- `routers.py` valida entradas con `ServerCalcJobCreateSerializer`.
- El serializer de respuesta expone una estructura estable para frontend.
"""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import DEFAULT_ALGORITHM_VERSION


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job Server Calc",
            value={
                "version": "1.1.0",
                "a": 7.0,
                "op": "*",
                "b": 6.0,
            },
            request_only=True,
            description=(
                "Calcula 7 * 6 en el servidor remoto qta vía SSH. El remoto "
                "escribe un archivo con 'a op b = result' y lo reporta."
            ),
        )
    ]
)
class ServerCalcJobCreateSerializer(serializers.Serializer):
    """Valida parámetros de creación para jobs de cálculo remoto."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    a = serializers.FloatField(
        help_text="Primer operando.",
    )
    op = serializers.ChoiceField(
        choices=["+", "-", "*", "/"],
        help_text="Operador: + - * /.",
    )
    b = serializers.FloatField(
        help_text="Segundo operando.",
    )

    def validate(
        self,
        attrs: dict[str, object],
    ) -> dict[str, object]:
        """Rechaza división por cero antes de encolar."""
        if str(attrs["op"]) == "/" and not float(attrs["b"]):  # type: ignore[arg-type]
            raise serializers.ValidationError({"b": "División por cero no permitida."})
        return attrs


class ServerCalcParametersSerializer(serializers.Serializer):
    """Parámetros persistidos de entrada para un job Server Calc."""

    a = serializers.FloatField()
    op = serializers.CharField(max_length=4)
    b = serializers.FloatField()


class ServerCalcMetadataSerializer(serializers.Serializer):
    """Metadatos técnicos de resultado Server Calc."""

    executed_on = serializers.CharField(max_length=50)
    remote_host = serializers.CharField(max_length=255)


class ServerCalcResultSerializer(serializers.Serializer):
    """Resultado tipado del cálculo Server Calc."""

    a = serializers.FloatField(help_text="Primer operando.")
    op = serializers.CharField(max_length=4, help_text="Operador aplicado.")
    b = serializers.FloatField(help_text="Segundo operando.")
    result = serializers.FloatField(help_text="Resultado de a op b.")
    file_name = serializers.CharField(
        max_length=255, help_text="Archivo escrito en qta."
    )
    file_path = serializers.CharField(
        max_length=512, help_text="Ruta del archivo en qta."
    )
    metadata = ServerCalcMetadataSerializer()


class ServerCalcJobResponseSerializer(serializers.ModelSerializer):
    """Respuesta estable para jobs de la app Server Calc."""

    parameters = ServerCalcParametersSerializer()
    results = ServerCalcResultSerializer(allow_null=True, required=False)

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

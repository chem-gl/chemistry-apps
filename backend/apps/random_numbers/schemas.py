"""schemas.py: Contratos OpenAPI estrictos para la app random_numbers.

Objetivo del archivo:
- Declarar serializers de request/response como contrato público HTTP de la app.

Cómo se usa:
- `routers.py` valida entradas con `RandomNumbersJobCreateSerializer`.
- `RandomNumbersJobResponseSerializer` define la forma estable de salida para
    polling, monitoreo y documentación OpenAPI.
- Las restricciones de campos deben mantenerse alineadas con `plugin.py`.
"""

from apps.core.models import ScientificJob
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .definitions import (
    DEFAULT_ALGORITHM_VERSION,
    MAX_INTERVAL_SECONDS,
    MAX_NUMBERS_PER_BATCH,
    MAX_TOTAL_NUMBERS,
)


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Crear job random numbers",
            value={
                "version": "1.0.0",
                "seed_url": "https://example.com/seed.txt",
                "numbers_per_batch": 5,
                "interval_seconds": 120,
                "total_numbers": 55,
            },
            request_only=True,
            description="Genera 55 números en lotes de 5 con 120 segundos entre lotes.",
        )
    ]
)
class RandomNumbersJobCreateSerializer(serializers.Serializer):
    """Valida request de creación para jobs de generación aleatoria."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    seed_url = serializers.URLField(
        help_text="URL cuyo contenido se usa como semilla determinista."
    )
    numbers_per_batch = serializers.IntegerField(
        min_value=1,
        max_value=MAX_NUMBERS_PER_BATCH,
        help_text="Cantidad de números generados por ciclo.",
    )
    interval_seconds = serializers.IntegerField(
        min_value=1,
        max_value=MAX_INTERVAL_SECONDS,
        help_text="Tiempo de espera entre ciclos de generación en segundos.",
    )
    total_numbers = serializers.IntegerField(
        min_value=1,
        max_value=MAX_TOTAL_NUMBERS,
        help_text="Cantidad total de números aleatorios a generar.",
    )


class RandomNumbersParametersSerializer(serializers.Serializer):
    """Contrato persistido de parámetros del job random_numbers."""

    seed_url = serializers.URLField()
    numbers_per_batch = serializers.IntegerField(min_value=1)
    interval_seconds = serializers.IntegerField(min_value=1)
    total_numbers = serializers.IntegerField(min_value=1)


class RandomNumbersResultMetadataSerializer(serializers.Serializer):
    """Metadatos del resultado de generación aleatoria."""

    seed_url = serializers.URLField()
    seed_digest = serializers.CharField(max_length=64)
    numbers_per_batch = serializers.IntegerField(min_value=1)
    interval_seconds = serializers.IntegerField(min_value=1)
    total_numbers = serializers.IntegerField(min_value=1)


class RandomNumbersResultSerializer(serializers.Serializer):
    """Resultado tipado de números aleatorios generados."""

    generated_numbers = serializers.ListField(
        child=serializers.IntegerField(min_value=0)
    )
    metadata = RandomNumbersResultMetadataSerializer()


class RandomNumbersJobResponseSerializer(serializers.ModelSerializer):
    """Salida tipada para jobs de random_numbers."""

    parameters = RandomNumbersParametersSerializer()
    results = RandomNumbersResultSerializer(allow_null=True, required=False)

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

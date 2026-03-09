"""schemas.py: Serializers HTTP y ejemplos OpenAPI del dominio core."""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .models import ScientificJob


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Ejemplo de Creación de Job",
            value={
                "plugin_name": "calculator",
                "version": "1.0",
                "parameters": {"op": "add", "a": 5, "b": 3},
            },
            request_only=True,
            description="Creación de una tarea matemática en background.",
        )
    ]
)
class JobCreateSerializer(serializers.Serializer):
    """
    Serializer puro para las peticiones de creación de un nuevo
    Job científico, siguiendo fuertemente el schema de OpenAPI.
    """

    plugin_name = serializers.CharField(
        max_length=100,
        help_text="El nombre registrado del plugin o algoritmo a ejecutar.",
    )
    version = serializers.CharField(
        max_length=50,
        default="1.0",
        help_text="Versión asociada del algoritmo que será parte de la llave de caché.",
    )
    parameters = serializers.JSONField(
        help_text="Diccionario dinámico de inputs o parámetros del job."
    )


class ErrorResponseSerializer(serializers.Serializer):
    """Schema consistente para respuestas de error API."""

    detail = serializers.CharField(help_text="Descripción del error manejado por API.")


class ScientificJobSerializer(serializers.ModelSerializer):
    """
    Serializer central que describe toda la entidad del Job.
    Usado como schema de salida.
    """

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

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


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Snapshot de progreso",
            value={
                "job_id": "8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",
                "status": "running",
                "progress_percentage": 35,
                "progress_stage": "running",
                "progress_message": "Ejecutando plugin científico.",
                "progress_event_index": 3,
                "updated_at": "2026-03-10T12:00:00Z",
            },
            response_only=True,
            description="Estado actual del job para consumo por polling o SSE.",
        )
    ]
)
class JobProgressSnapshotSerializer(serializers.Serializer):
    """Contrato de progreso de job usado en endpoint snapshot y stream SSE."""

    job_id = serializers.UUIDField(help_text="Identificador único del job.")
    status = serializers.ChoiceField(
        choices=[
            ("pending", "Pending"),
            ("running", "Running"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ],
        help_text="Estado principal del ciclo de vida del job.",
    )
    progress_percentage = serializers.IntegerField(
        min_value=0,
        max_value=100,
        help_text="Porcentaje de avance entre 0 y 100.",
    )
    progress_stage = serializers.ChoiceField(
        choices=[
            ("pending", "pending"),
            ("queued", "queued"),
            ("running", "running"),
            ("caching", "caching"),
            ("completed", "completed"),
            ("failed", "failed"),
        ],
        help_text="Etapa fina de ejecución para seguimiento en tiempo real.",
    )
    progress_message = serializers.CharField(
        help_text="Mensaje legible para usuario con contexto de ejecución."
    )
    progress_event_index = serializers.IntegerField(
        min_value=0,
        help_text="Contador incremental de eventos emitidos por el job.",
    )
    updated_at = serializers.DateTimeField(
        help_text="Marca temporal de última actualización."
    )


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

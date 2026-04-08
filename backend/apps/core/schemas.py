"""schemas.py: Serializers HTTP y ejemplos OpenAPI del dominio core.

Objetivo del archivo:
- Definir contratos de entrada/salida de la API común de jobs con ejemplos
    OpenAPI consistentes para integraciones frontend/backend.

Cómo se usa:
- `routers.py` usa estos serializers para validar requests y serializar
    respuestas en endpoints genéricos del dominio core.
- Las apps consumidoras pueden reutilizar estos contratos de error y progreso.
"""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .models import ScientificJob

JOB_ID_HELP_TEXT = "Identificador único del job."


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


class JobControlActionResponseSerializer(serializers.Serializer):
    """Respuesta estándar para acciones de control (pause/resume)."""

    detail = serializers.CharField(help_text="Resultado de la operación de control.")
    job = serializers.JSONField(
        help_text="Snapshot actualizado del job tras la acción."
    )


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

    job_id = serializers.UUIDField(help_text=JOB_ID_HELP_TEXT)
    status = serializers.ChoiceField(
        choices=[
            ("pending", "Pending"),
            ("running", "Running"),
            ("paused", "Paused"),
            ("completed", "Completed"),
            ("failed", "Failed"),
            ("cancelled", "Cancelled"),
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
            ("paused", "paused"),
            ("recovering", "recovering"),
            ("caching", "caching"),
            ("completed", "completed"),
            ("failed", "failed"),
            ("cancelled", "cancelled"),
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


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Evento de log de job",
            value={
                "job_id": "8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",
                "event_index": 12,
                "level": "info",
                "source": "random_numbers.plugin",
                "message": "Procesando lote de generación.",
                "payload": {
                    "current_batch_size": 5,
                    "generated_count_before_batch": 10,
                    "remaining_numbers": 7,
                },
                "created_at": "2026-03-11T10:25:00Z",
            },
            response_only=True,
            description="Evento de observabilidad de ejecución correlacionado por job.",
        )
    ]
)
class JobLogEventSerializer(serializers.Serializer):
    """Contrato de un evento de log persistido para un job."""

    job_id = serializers.UUIDField(help_text=JOB_ID_HELP_TEXT)
    event_index = serializers.IntegerField(
        min_value=1,
        help_text="Índice incremental del evento de log dentro del job.",
    )
    level = serializers.ChoiceField(
        choices=[
            ("debug", "debug"),
            ("info", "info"),
            ("warning", "warning"),
            ("error", "error"),
        ],
        help_text="Nivel de severidad del evento de log.",
    )
    source = serializers.CharField(help_text="Origen del evento de log.")
    message = serializers.CharField(help_text="Mensaje de observabilidad.")
    payload = serializers.JSONField(
        help_text="Contexto estructurado adicional del evento de log."
    )
    created_at = serializers.DateTimeField(
        help_text="Marca temporal de creación del evento."
    )


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Listado de logs por job",
            value={
                "job_id": "8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",
                "count": 2,
                "next_after_event_index": 13,
                "results": [
                    {
                        "job_id": "8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",
                        "event_index": 12,
                        "level": "info",
                        "source": "random_numbers.plugin",
                        "message": "Procesando lote de generación.",
                        "payload": {"current_batch_size": 5},
                        "created_at": "2026-03-11T10:25:00Z",
                    },
                    {
                        "job_id": "8ca8c1fa-1f2f-4a13-9038-9e1be7d0ce24",
                        "event_index": 13,
                        "level": "debug",
                        "source": "random_numbers.plugin",
                        "message": "Número generado correctamente.",
                        "payload": {"generated_number": 1024},
                        "created_at": "2026-03-11T10:25:01Z",
                    },
                ],
            },
            response_only=True,
            description="Página de logs de ejecución de un job.",
        )
    ]
)
class JobLogListSerializer(serializers.Serializer):
    """Contrato de respuesta para listado paginado de logs por job."""

    job_id = serializers.UUIDField(help_text=JOB_ID_HELP_TEXT)
    count = serializers.IntegerField(
        min_value=0,
        help_text="Cantidad de eventos en la página de resultados.",
    )
    next_after_event_index = serializers.IntegerField(
        min_value=0,
        help_text="Cursor recomendado para consultar la siguiente página.",
    )
    results = JobLogEventSerializer(many=True)


class ScientificJobSerializer(serializers.ModelSerializer):
    """
    Serializer central que describe toda la entidad del Job.
    Usado como schema de salida.
    """

    owner_username = serializers.CharField(source="owner.username", read_only=True)
    group_name = serializers.CharField(source="group.name", read_only=True)

    class Meta:
        model = ScientificJob
        fields = [
            "id",
            "owner",
            "owner_username",
            "group",
            "group_name",
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
            "supports_pause_resume",
            "pause_requested",
            "runtime_state",
            "paused_at",
            "resumed_at",
            "parameters",
            "results",
            "error_trace",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance: ScientificJob):
        """Normaliza salida terminal para evitar inconsistencias legacy en UI."""
        raw_representation = super().to_representation(instance)

        normalized_representation = dict(raw_representation)
        job_status_value: str = str(instance.status)

        if job_status_value in {"completed", "failed"}:
            normalized_representation["progress_percentage"] = 100
            normalized_representation["progress_stage"] = job_status_value

            if job_status_value == "completed":
                normalized_representation["progress_message"] = (
                    "Job completado correctamente."
                )
            else:
                normalized_representation["progress_message"] = (
                    "Job finalizado con error. Revisar error_trace."
                )

        return normalized_representation

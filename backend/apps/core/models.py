"""models.py: Entidades persistentes para jobs cientificos y cache por hash.

Objetivo del archivo:
- Modelar el estado durable del ciclo de vida de jobs, cache de resultados y
    eventos de logs para trazabilidad operativa.

Cómo se usa:
- `services.py` crea/actualiza `ScientificJob` y `ScientificCacheEntry`.
- `adapters.py` persiste eventos en `ScientificJobLogEvent`.
- `routers.py`, `consumers.py` y `realtime.py` serializan estos datos para API
    HTTP y streaming WebSocket/SSE.
"""

import uuid

from django.db import models


class ScientificJob(models.Model):
    """Representa un job cientifico ejecutable de forma asincrona."""

    STATUS_CHOICES: list[tuple[str, str]] = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("paused", "Paused"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_hash = models.CharField(
        max_length=64, db_index=True, help_text="Hash SHA-256 for caching"
    )
    plugin_name = models.CharField(max_length=100)
    algorithm_version = models.CharField(max_length=50, default="1.0")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")

    # Trazabilidad
    cache_hit = models.BooleanField(default=False)
    cache_miss = models.BooleanField(default=True)

    # Persistencia simple de parámetros/resultados.
    parameters = models.JSONField(default=dict)
    results = models.JSONField(default=dict, blank=True, null=True)
    error_trace = models.TextField(blank=True, null=True)

    # Progreso de ejecución para consultas y streaming de eventos SSE.
    progress_percentage = models.PositiveIntegerField(
        default=0,
        help_text="Porcentaje de progreso entre 0 y 100.",
    )
    progress_stage = models.CharField(
        max_length=40,
        default="pending",
        help_text="Etapa actual de ejecución: pending/queued/running/paused/caching/completed/failed.",
    )
    progress_message = models.CharField(
        max_length=255,
        default="Job creado y pendiente de ejecución.",
        help_text="Mensaje corto y legible del estado de progreso.",
    )
    progress_event_index = models.PositiveIntegerField(
        default=0,
        help_text="Contador incremental de eventos de progreso emitidos.",
    )
    supports_pause_resume = models.BooleanField(
        default=False,
        help_text="Indica si el plugin permite pausa cooperativa y reanudación.",
    )
    pause_requested = models.BooleanField(
        default=False,
        help_text="Marca de control cooperativo para solicitar pausa de ejecución.",
    )
    runtime_state = models.JSONField(
        default=dict,
        blank=True,
        help_text="Estado serializable de ejecución para reanudar tareas pausadas.",
    )
    paused_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Marca temporal del último momento en que el job quedó en pausa.",
    )
    resumed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Marca temporal de la última reanudación explícita del job.",
    )
    last_heartbeat_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Última señal de vida del proceso de ejecución del job.",
    )
    recovery_attempts = models.PositiveIntegerField(
        default=0,
        help_text="Cantidad de intentos de recuperación aplicados al job.",
    )
    max_recovery_attempts = models.PositiveIntegerField(
        default=5,
        help_text="Cantidad máxima de reencolados automáticos permitidos.",
    )
    last_recovered_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Marca temporal del último intento de recuperación activa.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """Retorna una representación compacta para trazabilidad de logs."""
        return f"{self.plugin_name} - {self.id} ({self.status})"


class ScientificCacheEntry(models.Model):
    """Persistencia de resultados por hash para evitar recomputo cientifico."""

    job_hash = models.CharField(max_length=64, unique=True)
    plugin_name = models.CharField(max_length=100)
    algorithm_version = models.CharField(max_length=50)
    result_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    last_accessed_at = models.DateTimeField(auto_now=True)
    hit_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-last_accessed_at"]

    def __str__(self) -> str:
        return f"Cache<{self.plugin_name}:{self.algorithm_version}:{self.job_hash[:8]}>"


class ScientificJobLogEvent(models.Model):
    """Evento de log persistido y correlacionado con un job científico."""

    LEVEL_CHOICES: list[tuple[str, str]] = [
        ("debug", "Debug"),
        ("info", "Info"),
        ("warning", "Warning"),
        ("error", "Error"),
    ]

    job = models.ForeignKey(
        ScientificJob,
        on_delete=models.CASCADE,
        related_name="log_events",
    )
    event_index = models.PositiveIntegerField(
        help_text="Indice incremental de evento dentro del job.",
    )
    level = models.CharField(
        max_length=10,
        choices=LEVEL_CHOICES,
        default="info",
        help_text="Nivel del log emitido por runtime o plugin.",
    )
    source = models.CharField(
        max_length=80,
        default="core.runtime",
        help_text="Origen del evento de log para diagnostico.",
    )
    message = models.CharField(
        max_length=255,
        help_text="Mensaje de log legible para diagnostico de ejecucion.",
    )
    payload = models.JSONField(
        default=dict,
        blank=True,
        help_text="Contexto estructurado adicional del evento.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["event_index", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["job", "event_index"],
                name="unique_job_log_event_index",
            )
        ]
        indexes = [
            models.Index(fields=["job", "event_index"]),
            models.Index(fields=["job", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"JobLog<{self.job_id}:{self.event_index}:{self.level}>"


class ScientificJobInputArtifact(models.Model):
    """Metadatos de artefactos de entrada asociados a un job científico."""

    ROLE_CHOICES: list[tuple[str, str]] = [
        ("input", "Input"),
        ("auxiliary", "Auxiliary"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        ScientificJob,
        on_delete=models.CASCADE,
        related_name="input_artifacts",
    )
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default="input",
        help_text="Rol del artefacto para trazabilidad de negocio.",
    )
    field_name = models.CharField(
        max_length=80,
        help_text="Nombre del campo multipart de origen.",
    )
    original_filename = models.CharField(
        max_length=255,
        help_text="Nombre de archivo reportado por el cliente.",
    )
    content_type = models.CharField(
        max_length=120,
        default="application/octet-stream",
        help_text="Tipo MIME recibido durante la carga.",
    )
    sha256 = models.CharField(
        max_length=64,
        help_text="Hash SHA-256 calculado sobre el contenido completo.",
    )
    size_bytes = models.PositiveBigIntegerField(
        default=0,
        help_text="Tamaño total del artefacto en bytes.",
    )
    chunk_count = models.PositiveIntegerField(
        default=0,
        help_text="Cantidad de chunks persistidos para reconstrucción.",
    )
    # Política de retención: None → permanente (archivo ≤ umbral de tamaño).
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        default=None,
        help_text=(
            "Fecha de expiración de los chunks binarios. "
            "None = archivo pequeño, se conserva de forma permanente. "
            "Pasada esta fecha la tarea de limpieza borra los chunks pero "
            "preserva los metadatos y el resultado del job."
        ),
    )
    chunks_purged_at = models.DateTimeField(
        null=True,
        blank=True,
        default=None,
        help_text=(
            "Fecha en que se eliminaron los chunks binarios. "
            "None = chunks aún disponibles en DB."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["job", "field_name"]),
            models.Index(fields=["job", "created_at"]),
            models.Index(fields=["sha256"]),
            models.Index(fields=["expires_at"]),
            models.Index(fields=["chunks_purged_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"InputArtifact<{self.job_id}:{self.field_name}:{self.original_filename}>"
        )


class ScientificJobInputArtifactChunk(models.Model):
    """Persistencia chunked del contenido binario de un artefacto de entrada."""

    artifact = models.ForeignKey(
        ScientificJobInputArtifact,
        on_delete=models.CASCADE,
        related_name="chunks",
    )
    chunk_index = models.PositiveIntegerField(
        help_text="Índice incremental del chunk para reconstrucción ordenada.",
    )
    chunk_data = models.BinaryField(help_text="Contenido binario del fragmento.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["chunk_index"]
        constraints = [
            models.UniqueConstraint(
                fields=["artifact", "chunk_index"],
                name="unique_input_artifact_chunk_index",
            )
        ]
        indexes = [
            models.Index(fields=["artifact", "chunk_index"]),
        ]

    def __str__(self) -> str:
        return f"InputArtifactChunk<{self.artifact_id}:{self.chunk_index}>"

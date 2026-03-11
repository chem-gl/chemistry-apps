"""models.py: Entidades persistentes para jobs cientificos y cache por hash."""

import uuid

from django.db import models


class ScientificJob(models.Model):
    """Representa un job cientifico ejecutable de forma asincrona."""

    STATUS_CHOICES: list[tuple[str, str]] = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
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
        help_text="Etapa actual de ejecución: pending/queued/running/caching/completed/failed.",
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

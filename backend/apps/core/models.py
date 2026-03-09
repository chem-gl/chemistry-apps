"""models.py: Entidades persistentes para jobs cientificos y cache por hash."""

import uuid

from django.db import models


class ScientificJob(models.Model):
    """Representa un job cientifico ejecutable de forma asincrona."""

    STATUS_CHOICES = [
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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
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

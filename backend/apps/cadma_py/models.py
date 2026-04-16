"""models.py: Persistencia de familias de referencia para CADMA Py.

La app guarda familias de referencia por enfermedad con trazabilidad mínima de
publicación, alcance por rol/grupo y filas químicas ya normalizadas.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

from apps.core.models import WORK_GROUP_MODEL_REF


class CadmaReferenceLibrary(models.Model):
    """Familia de referencia reutilizable para comparación de candidatos."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=160)
    disease_name = models.CharField(max_length=160, db_index=True)
    description = models.TextField(blank=True, default="")
    paper_reference = models.CharField(max_length=300, blank=True, default="")
    paper_url = models.CharField(max_length=500, blank=True, default="")
    source_reference = models.CharField(max_length=80, blank=True, default="")
    provenance_metadata = models.JSONField(default=dict, blank=True)
    reference_rows = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cadma_reference_libraries",
    )
    group = models.ForeignKey(
        WORK_GROUP_MODEL_REF,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cadma_reference_libraries",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["disease_name", "name", "-updated_at"]
        indexes = [
            models.Index(fields=["source_reference", "is_active"]),
            models.Index(fields=["group", "is_active"]),
            models.Index(fields=["created_by", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"CadmaReferenceLibrary<{self.disease_name}:{self.name}>"


class CadmaReferenceSourceFile(models.Model):
    """Archivo fuente persistido para trazabilidad de una familia de referencia."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    library = models.ForeignKey(
        CadmaReferenceLibrary,
        on_delete=models.CASCADE,
        related_name="source_files",
    )
    field_name = models.CharField(max_length=80)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True, default="")
    size_bytes = models.PositiveBigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True, default="")
    file = models.FileField(upload_to="cadma_py/reference_sources/%Y/%m/%d")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "field_name", "original_filename"]
        indexes = [
            models.Index(fields=["library", "field_name"]),
        ]

    def __str__(self) -> str:
        return f"CadmaReferenceSourceFile<{self.field_name}:{self.original_filename}>"

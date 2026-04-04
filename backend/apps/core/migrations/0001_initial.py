"""0001_initial.py: Migración inicial unificada del core científico.

Objetivo:
- Crear todas las tablas del dominio core en una sola migración limpia.
- Unifica lo que antes eran 0001_initial + 0002_input_artifacts + 0003_artifact_retention.

Modelos que crea:
  ScientificCacheEntry          — caché de resultados por hash SHA-256.
  ScientificJob                 — ciclo de vida de jobs asíncronos.
  ScientificJobLogEvent         — trazabilidad de logs de ejecución.
  ScientificJobInputArtifact    — metadatos de artefactos de entrada con política
                                  de retención (expires_at / chunks_purged_at).
  ScientificJobInputArtifactChunk — contenido binario chunked de cada artefacto.

Política de retención de artefactos:
  - expires_at = None           → archivo permanente (tamaño ≤ umbral configurado).
  - expires_at = <datetime>     → los chunks se eliminan pasada esa fecha.
  - chunks_purged_at = <datetime> → registro de cuándo se realizó la purga.
  Los metadatos (sha256, tamaño, nombre) y el resultado del job se conservan
  siempre; sólo el binario crudo es eliminable.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Única migración de estado inicial del core científico."""

    initial = True

    dependencies: list = []

    operations = [
        # ------------------------------------------------------------------
        # ScientificCacheEntry
        # Almacena resultados previamente calculados indexados por job_hash.
        # Permite evitar recalcular el mismo job cuando los parámetros y
        # entradas son idénticos (determinismo por SHA-256).
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name="ScientificCacheEntry",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                # Hash único que identifica la combinación (plugin + version + parámetros + archivos).
                ("job_hash", models.CharField(max_length=64, unique=True)),
                ("plugin_name", models.CharField(max_length=100)),
                ("algorithm_version", models.CharField(max_length=50)),
                # Resultado serializado retornado por el plugin para este job_hash.
                ("result_payload", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_accessed_at", models.DateTimeField(auto_now=True)),
                # Contador de cuántas veces se sirvió este resultado desde caché.
                ("hit_count", models.PositiveIntegerField(default=0)),
            ],
            options={
                "ordering": ["-last_accessed_at"],
            },
        ),
        # ------------------------------------------------------------------
        # ScientificJob
        # Entidad principal del ciclo de vida: created → queued → running →
        # completed/failed. Soporta pausa cooperativa y recuperación activa
        # ante caídas del worker Celery.
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name="ScientificJob",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "job_hash",
                    models.CharField(
                        db_index=True,
                        help_text="Hash SHA-256 para detección de caché hit.",
                        max_length=64,
                    ),
                ),
                ("plugin_name", models.CharField(max_length=100)),
                ("algorithm_version", models.CharField(default="1.0", max_length=50)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("running", "Running"),
                            ("paused", "Paused"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                # Indicadores de caché para trazabilidad de performance.
                ("cache_hit", models.BooleanField(default=False)),
                ("cache_miss", models.BooleanField(default=True)),
                # Parámetros de entrada y resultados de ejecución.
                ("parameters", models.JSONField(default=dict)),
                ("results", models.JSONField(blank=True, default=dict, null=True)),
                ("error_trace", models.TextField(blank=True, default="")),
                (
                    "progress_percentage",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Porcentaje de progreso entre 0 y 100.",
                    ),
                ),
                (
                    "progress_stage",
                    models.CharField(
                        default="pending",
                        help_text=(
                            "Etapa actual de ejecución: "
                            "pending/queued/running/paused/caching/completed/failed."
                        ),
                        max_length=40,
                    ),
                ),
                (
                    "progress_message",
                    models.CharField(
                        default="Job creado y pendiente de ejecución.",
                        help_text="Mensaje corto y legible del estado de progreso.",
                        max_length=255,
                    ),
                ),
                (
                    "progress_event_index",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Contador incremental de eventos de progreso emitidos.",
                    ),
                ),
                # Campos de control para pausa cooperativa.
                (
                    "supports_pause_resume",
                    models.BooleanField(
                        default=False,
                        help_text="Indica si el plugin permite pausa cooperativa y reanudación.",
                    ),
                ),
                (
                    "pause_requested",
                    models.BooleanField(
                        default=False,
                        help_text="Marca de control cooperativo para solicitar pausa de ejecución.",
                    ),
                ),
                (
                    "runtime_state",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Estado serializable de ejecución para reanudar tareas pausadas.",
                    ),
                ),
                (
                    "paused_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Marca temporal del último momento en que el job quedó en pausa.",
                        null=True,
                    ),
                ),
                (
                    "resumed_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Marca temporal de la última reanudación explícita del job.",
                        null=True,
                    ),
                ),
                # Campos de trazabilidad para recuperación activa de jobs huérfanos.
                (
                    "last_heartbeat_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Última señal de vida del proceso de ejecución del job.",
                        null=True,
                    ),
                ),
                (
                    "recovery_attempts",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Cantidad de intentos de recuperación aplicados al job.",
                    ),
                ),
                (
                    "max_recovery_attempts",
                    models.PositiveIntegerField(
                        default=5,
                        help_text="Cantidad máxima de reencolados automáticos permitidos.",
                    ),
                ),
                (
                    "last_recovered_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Marca temporal del último intento de recuperación activa.",
                        null=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        # ------------------------------------------------------------------
        # ScientificJobLogEvent
        # Registro inmutable de eventos de log emitidos durante la ejecución.
        # Permite diagnóstico detallado sin acceder al worker directamente.
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name="ScientificJobLogEvent",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "event_index",
                    models.PositiveIntegerField(
                        help_text="Índice incremental de evento dentro del job.",
                    ),
                ),
                (
                    "level",
                    models.CharField(
                        choices=[
                            ("debug", "Debug"),
                            ("info", "Info"),
                            ("warning", "Warning"),
                            ("error", "Error"),
                        ],
                        default="info",
                        help_text="Nivel del log emitido por runtime o plugin.",
                        max_length=10,
                    ),
                ),
                (
                    "source",
                    models.CharField(
                        default="core.runtime",
                        help_text="Origen del evento de log para diagnóstico.",
                        max_length=80,
                    ),
                ),
                (
                    "message",
                    models.CharField(
                        help_text="Mensaje de log legible para diagnóstico de ejecución.",
                        max_length=255,
                    ),
                ),
                (
                    "payload",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Contexto estructurado adicional del evento.",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="log_events",
                        to="core.scientificjob",
                    ),
                ),
            ],
            options={
                "ordering": ["event_index", "created_at"],
                "indexes": [
                    models.Index(
                        fields=["job", "event_index"],
                        name="core_scient_job_id_aa0d63_idx",
                    ),
                    models.Index(
                        fields=["job", "created_at"],
                        name="core_scient_job_id_c02962_idx",
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("job", "event_index"),
                        name="unique_job_log_event_index",
                    ),
                ],
            },
        ),
        # ------------------------------------------------------------------
        # ScientificJobInputArtifact
        # Metadatos de cada archivo de entrada subido junto al job.
        #
        # Política de retención binaria (columnas expires_at / chunks_purged_at):
        #   - expires_at = NULL   → archivo permanente (≤ ARTIFACT_INLINE_THRESHOLD_KB).
        #   - expires_at = <dt>   → chunks eliminables pasada esa fecha.
        #   - chunks_purged_at    → se rellena cuando la tarea Celery
        #                           `purge_expired_artifact_chunks` ejecuta la purga.
        #
        # Qué se conserva siempre (incluso después de purga):
        #   sha256, size_bytes, original_filename, content_type, chunk_count,
        #   y el campo results del ScientificJob asociado.
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name="ScientificJobInputArtifact",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "role",
                    models.CharField(
                        choices=[("input", "Input"), ("auxiliary", "Auxiliary")],
                        default="input",
                        help_text="Rol del artefacto para trazabilidad de negocio.",
                        max_length=20,
                    ),
                ),
                # Nombre del campo multipart que originó el archivo (ej. "transition_state_file").
                (
                    "field_name",
                    models.CharField(
                        help_text="Nombre del campo multipart de origen.",
                        max_length=80,
                    ),
                ),
                (
                    "original_filename",
                    models.CharField(
                        help_text="Nombre de archivo reportado por el cliente.",
                        max_length=255,
                    ),
                ),
                (
                    "content_type",
                    models.CharField(
                        default="application/octet-stream",
                        help_text="Tipo MIME recibido durante la carga.",
                        max_length=120,
                    ),
                ),
                # Huella digital para deduplicación y verificación de integridad.
                (
                    "sha256",
                    models.CharField(
                        help_text="Hash SHA-256 calculado sobre el contenido completo.",
                        max_length=64,
                    ),
                ),
                (
                    "size_bytes",
                    models.PositiveBigIntegerField(
                        default=0,
                        help_text="Tamaño total del artefacto en bytes.",
                    ),
                ),
                (
                    "chunk_count",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Cantidad de chunks persistidos para reconstrucción.",
                    ),
                ),
                # -- Política de retención --------------------------------
                # NULL → archivo permanente (tamaño ≤ umbral del entorno).
                # <dt> → la tarea diaria puede purgar los chunks después de esta fecha.
                (
                    "expires_at",
                    models.DateTimeField(
                        blank=True,
                        default=None,
                        null=True,
                        help_text=(
                            "Fecha de expiración de los chunks binarios. "
                            "NULL = archivo pequeño, se conserva de forma permanente. "
                            "Pasada esta fecha la tarea de limpieza borra los chunks pero "
                            "preserva los metadatos y el resultado del job."
                        ),
                    ),
                ),
                # Registro de cuándo se ejecutó la purga (NULL = aún no purgado).
                (
                    "chunks_purged_at",
                    models.DateTimeField(
                        blank=True,
                        default=None,
                        null=True,
                        help_text=(
                            "Fecha en que se eliminaron los chunks binarios. "
                            "NULL = chunks aún disponibles en DB."
                        ),
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="input_artifacts",
                        to="core.scientificjob",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
                "indexes": [
                    # Consulta principal: todos los artefactos de un job por campo.
                    models.Index(
                        fields=["job", "field_name"],
                        name="core_scient_job_id_f5959c_idx",
                    ),
                    # Orden cronológico de artefactos dentro de un job.
                    models.Index(
                        fields=["job", "created_at"],
                        name="core_scient_job_id_dc5e64_idx",
                    ),
                    # Deduplicación y verificación de integridad por hash.
                    models.Index(
                        fields=["sha256"],
                        name="core_scient_sha256_734d1f_idx",
                    ),
                    # Tarea de purga: busca artefactos con expires_at <= ahora.
                    models.Index(
                        fields=["expires_at"],
                        name="core_artifac_expires_idx",
                    ),
                    # Filtro rápido para detectar artefactos no purgados (NULL).
                    models.Index(
                        fields=["chunks_purged_at"],
                        name="core_artifac_purged_idx",
                    ),
                ],
            },
        ),
        # ------------------------------------------------------------------
        # ScientificJobInputArtifactChunk
        # Almacena el contenido binario crudo de cada artefacto dividido en
        # fragmentos de 512 KB. La reconstrucción ordena por chunk_index y
        # concatena los bytes de cada fila.
        #
        # Estos registros son los que elimina la tarea de purga para archivos
        # grandes expirados; la fila ScientificJobInputArtifact se conserva.
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name="ScientificJobInputArtifactChunk",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                # Posición del fragmento para reconstrucción ordenada.
                (
                    "chunk_index",
                    models.PositiveIntegerField(
                        help_text="Índice incremental del chunk para reconstrucción ordenada.",
                    ),
                ),
                # Bytes crudos del fragmento (≤ 512 KB por defecto).
                (
                    "chunk_data",
                    models.BinaryField(
                        help_text="Contenido binario del fragmento.",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "artifact",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chunks",
                        to="core.scientificjobinputartifact",
                    ),
                ),
            ],
            options={
                "ordering": ["chunk_index"],
                "indexes": [
                    # Reconstrucción eficiente: recupera chunks de un artefacto ordenados.
                    models.Index(
                        fields=["artifact", "chunk_index"],
                        name="core_scient_artifac_a4993d_idx",
                    ),
                ],
                "constraints": [
                    # Garantiza unicidad de índice por artefacto para evitar duplicados.
                    models.UniqueConstraint(
                        fields=("artifact", "chunk_index"),
                        name="unique_input_artifact_chunk_index",
                    ),
                ],
            },
        ),
    ]

"""anonymous.py: Política de jobs anónimos para las apps libres (sin login).

Un job anónimo es un ``ScientificJob`` sin ``owner`` ni ``group`` creado desde
las rutas públicas. A diferencia de un job con cuenta:

- Vive un TTL corto (por defecto 24 h) y se elimina con purga periódica.
- Solo es accesible por *capability URL*: quien conoce el UUID puede consultarlo.
- No participa en listados, papelera ni control (pausa/cancelar).

El resultado científico sí puede quedar compartido en la caché exacta por hash,
con su propio TTL (por defecto 7 días).

Uso esperado:

    from apps.core.anonymous import resolve_job_expiration, purge_expired_anonymous_jobs

    expires_at = resolve_job_expiration(owner_id=None)   # job anónimo
    purged = purge_expired_anonymous_jobs()              # tarea periódica
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import QuerySet
from django.utils import timezone

from .concurrency import release_job_lease
from .models import ScientificJob

# Valores por defecto de la fase 1 (ver plan apps-libres [1/5] punto 9).
ANONYMOUS_JOB_TTL_HOURS_DEFAULT: int = 24
SHARED_CACHE_TTL_DAYS_DEFAULT: int = 7

# Tamaño de lote de la purga para no bloquear la base en una sola transacción.
PURGE_BATCH_SIZE_DEFAULT: int = 500
PURGE_MAX_BATCHES_DEFAULT: int = 20


def get_anonymous_job_ttl_hours() -> int:
    """Retorna el TTL en horas de un job anónimo (mínimo 1 h)."""
    configured_value = int(
        getattr(settings, "ANONYMOUS_JOB_TTL_HOURS", ANONYMOUS_JOB_TTL_HOURS_DEFAULT)
    )
    return max(1, configured_value)


def get_shared_cache_ttl_days() -> int:
    """Retorna el TTL en días de la caché exacta compartida (mínimo 1 día)."""
    configured_value = int(
        getattr(settings, "SHARED_CACHE_TTL_DAYS", SHARED_CACHE_TTL_DAYS_DEFAULT)
    )
    return max(1, configured_value)


def resolve_job_expiration(
    owner_id: int | None,
    *,
    now: datetime | None = None,
) -> datetime | None:
    """Resuelve ``expires_at`` al crear un job.

    Solo los jobs anónimos (sin ``owner``) expiran; los jobs con cuenta
    conservan la política de retención actual (``None`` = sin expiración).
    """
    if owner_id is not None:
        return None

    reference_now = now or timezone.now()
    return reference_now + timedelta(hours=get_anonymous_job_ttl_hours())


def is_anonymous_job(job: ScientificJob) -> bool:
    """Indica si el job no tiene dueño ni grupo (creado desde ruta pública)."""
    return job.owner_id is None


def is_expired_anonymous_job(
    job: ScientificJob,
    *,
    now: datetime | None = None,
) -> bool:
    """Indica si un job anónimo superó su ventana de vida útil."""
    if not is_anonymous_job(job) or job.expires_at is None:
        return False

    return job.expires_at <= (now or timezone.now())


def can_access_public_job(
    job: ScientificJob,
    *,
    now: datetime | None = None,
) -> bool:
    """Valida acceso por ``GET`` público al job (capability URL).

    Solo devuelve ``True`` para jobs anónimos no borrados y no expirados: las
    rutas públicas nunca exponen jobs de usuarios registrados.
    """
    if job.deleted_at is not None:
        return False

    return is_anonymous_job(job) and not is_expired_anonymous_job(job, now=now)


def anonymous_jobs_queryset() -> QuerySet[ScientificJob]:
    """Queryset base de jobs anónimos, sin filtrar por expiración."""
    return ScientificJob.objects.filter(owner__isnull=True)


def purge_expired_anonymous_jobs(
    *,
    now: datetime | None = None,
    batch_size: int = PURGE_BATCH_SIZE_DEFAULT,
    max_batches: int = PURGE_MAX_BATCHES_DEFAULT,
) -> int:
    """Elimina físicamente los jobs anónimos vencidos.

    El borrado en cascada limpia logs y artefactos asociados. Retorna la
    cantidad de jobs purgados. Procesa por lotes para acotar el impacto.
    """
    reference_now = now or timezone.now()
    purged_total = 0

    for _ in range(max(1, max_batches)):
        expired_ids = list(
            ScientificJob.objects.filter(
                owner__isnull=True,
                expires_at__isnull=False,
                expires_at__lte=reference_now,
            )
            .order_by("expires_at")
            .values_list("id", flat=True)[: max(1, batch_size)]
        )

        if not expired_ids:
            break

        # Liberar los leases antes de borrar: si no, el cupo del cliente queda
        # ocupado hasta que venza el TTL.
        for expired_job in ScientificJob.objects.filter(id__in=expired_ids):
            release_job_lease(expired_job, persist=False)

        ScientificJob.objects.filter(id__in=expired_ids).delete()
        purged_total += len(expired_ids)

        if len(expired_ids) < max(1, batch_size):
            break

    return purged_total

"""public_api.py: Mixin que expone apps científicas sin login (apps libres fase 1).

Objetivo del archivo:
- Reutilizar los ViewSets de cada app científica en una variante pública,
  sin duplicar validación ni lógica de despacho.
- Aplicar las reglas del modo libre: jobs sin dueño, acceso por *capability URL*
  (UUID) y superficie mínima de endpoints.

Cómo se usa (en el punto de composición, p. ej. ``config/public_urls.py``):

    class PublicMolarFractionsJobViewSet(PublicAppViewSetMixin, MolarFractionsJobViewSet):
        pass

Reglas garantizadas por el mixin:
1. ``create`` nunca asocia ``owner``/``group`` (job anónimo con TTL).
2. ``retrieve`` / ``report-csv`` solo devuelven jobs anónimos no expirados.
3. ``list``, ``report-log``, ``report-error`` y ``report-inputs`` no se exponen.
4. El límite de tasa aplica al despacho, nunca al polling de estado.
"""

from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle

from .anonymous import can_access_public_job
from .concurrency import (
    CONCURRENCY_LIMIT_DETAIL,
    TERMINAL_JOB_STATUSES,
    ConcurrencyLease,
    acquire_slot,
    attach_lease_to_job,
    release_lease,
)
from .models import ScientificJob
from .throttling import AnonymousDispatchRateThrottle
from .uuid_utils import resolve_uuid_or_none

PUBLIC_UNAVAILABLE_DETAIL: str = "Recurso no disponible en el API público."


class PublicAppViewSetMixin:
    """Variante pública (sin login) de un ViewSet de app científica."""

    permission_classes = [AllowAny]
    authentication_classes: list[type] = []
    throttle_classes: list[type[BaseThrottle]] = [AnonymousDispatchRateThrottle]

    # Whitelist explícita de acciones `@action` heredadas que SÍ se publican.
    # El resto de acciones (logs, inspecciones, catálogos, derivaciones) queda
    # fuera por defecto para no ampliar la superficie pública sin decisión.
    public_extra_actions: tuple[str, ...] = ("report_csv",)

    @classmethod
    def get_extra_actions(cls) -> list[object]:
        """Publica únicamente las acciones extra incluidas en la whitelist."""
        return [
            action_method
            for action_method in super().get_extra_actions()
            if getattr(action_method, "__name__", "") in cls.public_extra_actions
        ]

    def resolve_actor_job_scope(
        self, request: Request
    ) -> tuple[int | None, int | None]:
        """Fuerza jobs sin dueño ni grupo: el modo público es 100% anónimo."""
        del request
        return None, None

    def create(self, request: Request) -> Response:
        """Despacha el `create` de la app reservando un cupo de concurrencia.

        El cupo se reserva antes de crear el job y se libera si la creación
        falla o si el job nace ya terminal (cache hit), porque en esos casos
        ningún worker ejecutará la liberación.
        """
        lease = acquire_slot(request)
        if lease is None:
            return Response(
                {"detail": CONCURRENCY_LIMIT_DETAIL},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            response = super().create(request)
        except Exception:
            release_lease(lease)
            raise

        return self._finalize_public_dispatch(response, lease)

    def _finalize_public_dispatch(
        self, response: Response, lease: ConcurrencyLease
    ) -> Response:
        """Asocia el lease al job recién creado o lo libera si no habrá ejecución."""
        if response.status_code != status.HTTP_201_CREATED:
            release_lease(lease)
            return response

        response_payload = response.data if isinstance(response.data, dict) else {}
        job_id = str(response_payload.get("id", ""))
        job = ScientificJob.objects.filter(pk=job_id).first() if job_id else None

        if job is None or job.status in TERMINAL_JOB_STATUSES:
            release_lease(lease)
            return response

        attach_lease_to_job(job, lease)
        return response

    def get_throttles(self) -> list[BaseThrottle]:
        """Aplica el tope de despachos solo a ``create``.

        El polling del resultado (cada ~2 s) no debe consumir la cuota de
        despachos, por eso las acciones de lectura quedan sin throttle de tasa.
        """
        if getattr(self, "action", None) == "create":
            return [throttle_class() for throttle_class in self.throttle_classes]

        return []

    def get_job_queryset(self) -> "ScientificJob.objects":
        """Solo jobs anónimos, no borrados, del plugin de esta vista."""
        return ScientificJob.objects.filter(
            plugin_name=self.plugin_name,
            owner__isnull=True,
            deleted_at__isnull=True,
        )

    def get_job_or_404(self, job_id: str | None) -> ScientificJob:
        """Acceso por capability URL: UUID de un job anónimo no expirado.

        Devuelve 404 (nunca 403) para no revelar si el UUID existió.
        """
        normalized_job_id = resolve_uuid_or_none(job_id)
        if normalized_job_id is None:
            raise Http404("Job no encontrado.")

        job = get_object_or_404(
            ScientificJob,
            pk=normalized_job_id,
            plugin_name=self.plugin_name,
            owner__isnull=True,
        )

        if not can_access_public_job(job):
            raise Http404("Job no encontrado.")

        return job

    # ── Acciones heredadas que NO se exponen en el API público ──────────
    # Al redefinirlas sin el decorador @action, el router deja de publicarlas.

    def report_log(self, request: Request, id: str | None = None) -> None:
        """No disponible en modo público: el log expone parámetros de entrada."""
        del request, id
        raise Http404(PUBLIC_UNAVAILABLE_DETAIL)

    def report_error(self, request: Request, id: str | None = None) -> None:
        """No disponible en modo público: el reporte expone parámetros de entrada."""
        del request, id
        raise Http404(PUBLIC_UNAVAILABLE_DETAIL)

    def report_inputs(self, request: Request, id: str | None = None) -> None:
        """No disponible en modo público: devuelve archivos subidos."""
        del request, id
        raise Http404(PUBLIC_UNAVAILABLE_DETAIL)

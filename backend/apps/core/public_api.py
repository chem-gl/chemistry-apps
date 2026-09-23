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
2. ``retrieve`` / reportes / vistas de app solo devuelven jobs anónimos no expirados.
3. ``list`` y las acciones de escritura (catálogo Smile-it) no se exponen: el
   modo libre es de solo lectura sobre sus propios jobs.
4. El límite de tasa aplica al despacho (``public-dispatch``) y a las lecturas
   costosas (``public-read``); el polling del estado no consume cuota.
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
from .throttling import AnonymousDispatchRateThrottle, AnonymousReadRateThrottle
from .uuid_utils import resolve_uuid_or_none

# Acciones heredadas que el API público SÍ publica.
#
# Los reportes son la salida natural de un job anónimo: el UUID es la
# capability URL y el aviso de privacidad ya declara que los parámetros no son
# privados. Las vistas de app (derivaciones, SVG, catálogo de referencia,
# inspección de archivos) son de solo lectura y permiten que el modo libre
# funcione sin cuenta.
PUBLIC_REPORT_ACTIONS: tuple[str, ...] = (
    "report_csv",
    "report_csv_by_method",
    "report_log",
    "report_error",
    "report_inputs",
)

PUBLIC_APP_VIEW_ACTIONS: tuple[str, ...] = (
    "inspect_input",
    "inspect_structure",
    "derivations",
    "derivation_svg",
    "report_smiles",
    "report_traceability",
    "report_images_zip",
)


class PublicAppViewSetMixin:
    """Variante pública (sin login) de un ViewSet de app científica."""

    permission_classes = [AllowAny]
    authentication_classes: list[type] = []
    throttle_classes: list[type[BaseThrottle]] = [AnonymousDispatchRateThrottle]
    read_throttle_classes: list[type[BaseThrottle]] = [AnonymousReadRateThrottle]

    # El semáforo de registrados no aplica aquí: la ruta pública ya reserva su
    # propio cupo anónimo y un solo job no puede llevar dos leases a la vez.
    registered_concurrency_enabled: bool = False

    # Whitelist explícita de acciones `@action` heredadas que SÍ se publican.
    # Las acciones que no estén aquí (por ejemplo las de escritura del catálogo
    # Smile-it) quedan fuera: el modo libre es de solo lectura.
    public_extra_actions: tuple[str, ...] = (
        PUBLIC_REPORT_ACTIONS + PUBLIC_APP_VIEW_ACTIONS
    )

    # Acciones de lectura costosa que consumen la cuota `public-read`.
    public_read_throttled_actions: tuple[str, ...] = (
        PUBLIC_REPORT_ACTIONS + PUBLIC_APP_VIEW_ACTIONS
    )

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
        """Reparte los topes según el tipo de operación.

        - ``create``: cuota de despachos (``public-dispatch``).
        - Lecturas costosas (reportes, derivaciones, SVG, ZIP e inspecciones):
          cuota suave de lectura (``public-read``).
        - ``retrieve``: sin tope, porque el modo libre hace polling cada ~2 s
          y castigarlo rompería la experiencia sin proteger nada.
        """
        action_name = getattr(self, "action", None)

        if action_name == "create":
            return [throttle_class() for throttle_class in self.throttle_classes]

        if action_name in self.public_read_throttled_actions:
            return [
                throttle_class() for throttle_class in self.read_throttle_classes
            ]

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

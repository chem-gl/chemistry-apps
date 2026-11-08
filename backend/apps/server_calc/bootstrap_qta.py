"""bootstrap_qta.py: Bootstrap idempotente del grupo QTA Operators.

Crea el grupo de trabajo `qta-operators` con permiso habilitado para la app
`server-calc` y vincula al usuario root como admin del grupo. Pueden usar
Server Calc root, admin y miembros de qta-operators con el permiso habilitado
(ver `is_qta_operator`); el backend lo exige en `IsServerCalcAdmin` y el
frontend solo muestra la app si el catálogo la marca como habilitada.

Cómo se usa:
- `apps.py` conecta `ensure_qta_operators_group` al post_migrate de server_calc.
- Todas las operaciones son idempotentes y seguras de re-ejecutar.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractUser

from apps.core.app_registry import ScientificAppRegistry
from apps.core.models import AppPermission, GroupMembership, WorkGroup

from .definitions import PLUGIN_NAME

logger = logging.getLogger(__name__)

QTA_GROUP_NAME = "QTA Operators"
QTA_GROUP_SLUG = "qta-operators"
QTA_GROUP_DESCRIPTION = (
    "Grupo restringido a root/admin para operar la app Server Calc "
    "(cálculos remotos en el servidor qta vía SSH)."
)


def ensure_qta_operators_group() -> tuple[WorkGroup | None, bool]:
    """Garantiza grupo qta-operators con permiso para server-calc.

    Retorna (grupo, creado). Si la app aún no está registrada, no crea nada.
    """
    if ScientificAppRegistry.get_definition_by_route_key("server-calc") is None:
        logger.warning(
            "Bootstrap qta-operators omitido: server-calc no registrada.",
        )
        return None, False

    group, group_created = WorkGroup.objects.get_or_create(
        slug=QTA_GROUP_SLUG,
        defaults={
            "name": QTA_GROUP_NAME,
            "description": QTA_GROUP_DESCRIPTION,
            "created_by": _find_root_user(),
        },
    )
    if group_created:
        logger.info("Grupo qta-operators creado.")

    AppPermission.objects.get_or_create(
        app_name=PLUGIN_NAME,
        group=group,
        defaults={"is_enabled": True},
    )
    _ensure_superadmin_permission()

    root_user = _find_root_user()
    if root_user is not None:
        GroupMembership.objects.get_or_create(
            user=root_user,
            group=group,
            defaults={"role_in_group": GroupMembership.ROLE_ADMIN},
        )

    return group, group_created


def is_qta_operator(actor: AbstractUser) -> bool:
    """Indica si el actor es miembro de qta-operators con server-calc habilitado.

    Exige ambas condiciones: membresía explícita en el grupo y AppPermission
    `server-calc` habilitada para ese grupo. Un grupo sin permiso o con el
    permiso deshabilitado no concede acceso.
    """
    if not bool(getattr(actor, "is_authenticated", False)):
        return False
    return AppPermission.objects.filter(
        app_name=PLUGIN_NAME,
        group__slug=QTA_GROUP_SLUG,
        group__memberships__user_id=actor.pk,
        is_enabled=True,
    ).exists()


def _ensure_superadmin_permission() -> None:
    """Garantiza permiso de server-calc en Superadmin (apps nuevas no existen).

    El bootstrap de Superadmin solo crea permisos al crear el grupo; las apps
    registradas después nunca se agregan. Sin esto, root con grupo activo
    Superadmin no vería server-calc en el catálogo por grupo.
    """
    superadmin = WorkGroup.objects.filter(slug="superadmin").first()
    if superadmin is None:
        return
    _, created = AppPermission.objects.get_or_create(
        app_name=PLUGIN_NAME,
        group=superadmin,
        defaults={"is_enabled": True},
    )
    if created:
        logger.info("Permiso server-calc agregado al grupo Superadmin.")


def _find_root_user() -> AbstractUser | None:
    """Localiza al root (superusuario, perfil root o ROOT_USERNAME)."""
    user_model = get_user_model()
    root_user = user_model.objects.filter(is_superuser=True).order_by("id").first()
    if root_user is not None:
        return root_user
    configured_username = str(getattr(settings, "ROOT_USERNAME", "root") or "root")
    return user_model.objects.filter(username=configured_username).first()

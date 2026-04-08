"""superadmin_group.py: Bootstrap idempotente del grupo Superadmin con permisos completos.

Se ejecuta tras la creación del usuario root para garantizar que exista un grupo
con acceso habilitado a todas las apps científicas registradas. Esto permite que
el usuario administrador pueda crear tareas desde el primer arranque sin
configuración manual adicional.

Cómo se usa:
- `startup.py` invoca `ensure_superadmin_group(root_user)` tras `ensure_root_user()`.
- El grupo se crea una sola vez y las ejecuciones posteriores son idempotentes.
"""

from __future__ import annotations

import logging

from django.contrib.auth.models import AbstractUser

from ...app_registry import ScientificAppRegistry
from ...models import (
    AppPermission,
    GroupMembership,
    UserIdentityProfile,
    WorkGroup,
)

logger = logging.getLogger(__name__)

SUPERADMIN_GROUP_NAME = "Superadmin"
SUPERADMIN_GROUP_SLUG = "superadmin"
SUPERADMIN_GROUP_DESCRIPTION = (
    "Grupo administrativo con acceso completo a todas las aplicaciones "
    "científicas. Creado automáticamente durante el bootstrap inicial."
)


def ensure_superadmin_group(root_user: AbstractUser) -> tuple[WorkGroup, bool]:
    """Garantiza la existencia del grupo Superadmin con permisos completos.

    Retorna (grupo, creado). Todas las operaciones son idempotentes:
    - Crea el WorkGroup si no existe.
    - Vincula al root_user como admin del grupo si no tiene membresía.
    - Asigna el grupo como primary_group del root si no tiene uno.
    - Crea AppPermission(is_enabled=True) para cada app registrada.
    """
    group, group_created = WorkGroup.objects.get_or_create(
        slug=SUPERADMIN_GROUP_SLUG,
        defaults={
            "name": SUPERADMIN_GROUP_NAME,
            "description": SUPERADMIN_GROUP_DESCRIPTION,
            "created_by": root_user,
        },
    )

    if group_created:
        logger.info(
            "Grupo Superadmin creado: name=%s, slug=%s",
            group.name,
            group.slug,
        )

    _ensure_root_membership(root_user, group)
    _ensure_root_primary_group(root_user, group)
    _ensure_all_app_permissions(group)

    return group, group_created


def _ensure_root_membership(root_user: AbstractUser, group: WorkGroup) -> None:
    """Vincula al root como admin del grupo Superadmin si no tiene membresía."""
    _, membership_created = GroupMembership.objects.get_or_create(
        user=root_user,
        group=group,
        defaults={"role_in_group": GroupMembership.ROLE_ADMIN},
    )
    if membership_created:
        logger.info(
            "Membresía admin creada: user=%s, group=%s",
            root_user.username,
            group.slug,
        )


def _ensure_root_primary_group(root_user: AbstractUser, group: WorkGroup) -> None:
    """Asigna el grupo Superadmin como primary_group del root si no tiene uno."""
    profile, profile_created = UserIdentityProfile.objects.get_or_create(
        user=root_user,
        defaults={
            "role": UserIdentityProfile.ROLE_ROOT,
            "account_status": UserIdentityProfile.STATUS_ACTIVE,
            "primary_group": group,
        },
    )

    if profile_created:
        logger.info(
            "Perfil de identidad creado para root con primary_group=%s",
            group.slug,
        )
        return

    # Si el perfil ya existe pero no tiene grupo primario, asignarlo
    if profile.primary_group is None:
        profile.primary_group = group
        profile.save(update_fields=["primary_group"])
        logger.info(
            "primary_group actualizado para %s: %s",
            root_user.username,
            group.slug,
        )


def _ensure_all_app_permissions(group: WorkGroup) -> None:
    """Crea permisos habilitados para cada app científica registrada en el grupo."""
    registered_definitions = ScientificAppRegistry.list_definitions()
    existing_app_names: set[str] = set(
        AppPermission.objects.filter(group=group).values_list("app_name", flat=True)
    )

    new_permissions: list[AppPermission] = []
    for definition in registered_definitions:
        if definition.plugin_name not in existing_app_names:
            new_permissions.append(
                AppPermission(
                    app_name=definition.plugin_name,
                    group=group,
                    is_enabled=True,
                )
            )

    if new_permissions:
        AppPermission.objects.bulk_create(new_permissions)
        created_names = [permission.app_name for permission in new_permissions]
        logger.info(
            "Permisos de app creados para grupo Superadmin: %s",
            ", ".join(created_names),
        )

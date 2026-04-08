"""authorization_service.py: Reglas RBAC transversales para jobs y apps.

Centraliza permisos de visibilidad y acciones para root/admin/user y evita
duplicar lógica de autorización en routers de apps científicas.
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.db.models import Q, QuerySet

from ...app_registry import ScientificAppRegistry
from ...models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    ScientificJob,
    UserAppConfig,
    UserIdentityProfile,
)


class AuthorizationService:
    """Servicio de autorización reutilizable para todo el backend."""

    @staticmethod
    def is_root(actor: AbstractUser) -> bool:
        return bool(getattr(actor, "is_superuser", False)) or (
            AuthorizationService._resolve_role(actor) == "root"
        )

    @staticmethod
    def is_admin(actor: AbstractUser) -> bool:
        return bool(getattr(actor, "is_staff", False)) or (
            AuthorizationService._resolve_role(actor) == "admin"
        )

    @staticmethod
    def can_manage_user(actor: AbstractUser, target: AbstractUser) -> bool:
        if AuthorizationService.is_root(actor):
            return True
        if not AuthorizationService.is_admin(actor):
            return False

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        target_group_ids = AuthorizationService._group_ids_for_user(target)
        return len(actor_group_ids.intersection(target_group_ids)) > 0

    @staticmethod
    def can_view_job(actor: AbstractUser, job: ScientificJob) -> bool:
        if AuthorizationService.is_root(actor):
            return True
        if job.owner_id == actor.id:
            return True

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        if job.group_id in actor_group_ids:
            return True

        return False

    @staticmethod
    def can_manage_job(actor: AbstractUser, job: ScientificJob) -> bool:
        if AuthorizationService.is_root(actor):
            return True
        if job.owner_id == actor.id:
            return True

        if not AuthorizationService.is_admin(actor):
            return False

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        return job.group_id in actor_group_ids

    @staticmethod
    def get_visible_jobs(actor: AbstractUser) -> QuerySet[ScientificJob]:
        if AuthorizationService.is_root(actor):
            return ScientificJob.objects.all().order_by("-created_at")

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        return ScientificJob.objects.filter(
            Q(owner_id=actor.id) | Q(group_id__in=actor_group_ids)
        ).order_by("-created_at")

    @staticmethod
    def can_access_app(actor: AbstractUser, app_name: str) -> bool:
        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        group_rule = AuthorizationService._get_group_app_permission(
            actor_group_ids=actor_group_ids,
            app_name=app_name,
        )
        if group_rule is not None:
            return bool(group_rule.is_enabled)

        user_rule = AuthorizationService._get_user_app_permission(
            actor_id=actor.id,
            app_name=app_name,
        )
        if user_rule is not None:
            return bool(user_rule.is_enabled)

        return True

    @staticmethod
    def list_accessible_apps(actor: AbstractUser) -> list[dict[str, object]]:
        """Retorna catálogo de apps con visibilidad resuelta para el actor."""
        accessible_apps: list[dict[str, object]] = []
        actor_group_ids = AuthorizationService._group_ids_for_user(actor)

        for definition in ScientificAppRegistry.list_definitions():
            group_rule = AuthorizationService._get_group_app_permission(
                actor_group_ids=actor_group_ids,
                app_name=definition.plugin_name,
            )
            user_rule = AuthorizationService._get_user_app_permission(
                actor_id=actor.id,
                app_name=definition.plugin_name,
            )
            accessible_apps.append(
                {
                    "app_name": definition.plugin_name,
                    "route_key": definition.api_route_prefix,
                    "api_base_path": definition.api_base_path,
                    "supports_pause_resume": bool(definition.supports_pause_resume),
                    "enabled": AuthorizationService.can_access_app(
                        actor, definition.plugin_name
                    ),
                    "group_permission": None
                    if group_rule is None
                    else bool(group_rule.is_enabled),
                    "user_permission": None
                    if user_rule is None
                    else bool(user_rule.is_enabled),
                }
            )

        return accessible_apps

    @staticmethod
    def get_effective_app_config(
        actor: AbstractUser, app_name: str
    ) -> dict[str, object]:
        """Resuelve configuración efectiva usando precedencia grupo -> usuario."""
        group_config = AuthorizationService._get_group_app_config(actor, app_name)
        user_config = AuthorizationService._get_user_app_config(actor, app_name)
        effective_config: dict[str, object] = {}
        effective_config.update(group_config)
        effective_config.update(user_config)
        return {
            "app_name": app_name,
            "enabled": AuthorizationService.can_access_app(actor, app_name),
            "effective_config": effective_config,
            "group_config": group_config,
            "user_config": user_config,
        }

    @staticmethod
    def can_manage_group(actor: AbstractUser, group_id: int) -> bool:
        """Indica si el actor puede administrar configuración y miembros del grupo."""
        if AuthorizationService.is_root(actor):
            return True
        if not AuthorizationService.is_admin(actor):
            return False
        return GroupMembership.objects.filter(
            user_id=actor.id,
            group_id=group_id,
            role_in_group=GroupMembership.ROLE_ADMIN,
        ).exists()

    @staticmethod
    def _group_ids_for_user(actor: AbstractUser) -> set[int]:
        membership_group_ids = set(
            GroupMembership.objects.filter(user_id=actor.id).values_list(
                "group_id", flat=True
            )
        )
        primary_group_id = AuthorizationService.get_primary_group_id(actor)
        if primary_group_id is not None:
            membership_group_ids.add(int(primary_group_id))
        return membership_group_ids

    @staticmethod
    def get_primary_group_id(actor: AbstractUser) -> int | None:
        explicit_primary_group_id = getattr(actor, "primary_group_id", None)
        if explicit_primary_group_id is not None:
            return int(explicit_primary_group_id)

        profile = AuthorizationService._get_identity_profile(actor)
        if profile is None:
            return None
        return profile.primary_group_id

    @staticmethod
    def _resolve_role(actor: AbstractUser) -> str:
        explicit_role = getattr(actor, "role", "")
        if explicit_role in {"root", "admin", "user"}:
            return str(explicit_role)

        profile = AuthorizationService._get_identity_profile(actor)
        if profile is not None and profile.role in {"root", "admin", "user"}:
            return str(profile.role)

        if bool(getattr(actor, "is_superuser", False)):
            return "root"
        if bool(getattr(actor, "is_staff", False)):
            return "admin"
        return "user"

    @staticmethod
    def _get_identity_profile(actor: AbstractUser) -> UserIdentityProfile | None:
        related_profile = getattr(actor, "identity_profile", None)
        if related_profile is not None:
            return related_profile
        return UserIdentityProfile.objects.filter(user_id=actor.id).first()

    @staticmethod
    def _get_group_app_permission(
        *, actor_group_ids: set[int], app_name: str
    ) -> AppPermission | None:
        return (
            AppPermission.objects.filter(
                app_name=app_name, group_id__in=actor_group_ids
            )
            .order_by("-updated_at")
            .first()
        )

    @staticmethod
    def _get_user_app_permission(
        *, actor_id: int, app_name: str
    ) -> AppPermission | None:
        return (
            AppPermission.objects.filter(app_name=app_name, user_id=actor_id)
            .order_by("-updated_at")
            .first()
        )

    @staticmethod
    def _get_group_app_config(actor: AbstractUser, app_name: str) -> dict[str, object]:
        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        group_config = (
            GroupAppConfig.objects.filter(
                app_name=app_name, group_id__in=actor_group_ids
            )
            .order_by("-updated_at")
            .first()
        )
        if group_config is None:
            return {}
        return dict(group_config.config)

    @staticmethod
    def _get_user_app_config(actor: AbstractUser, app_name: str) -> dict[str, object]:
        user_config = UserAppConfig.objects.filter(
            user_id=actor.id, app_name=app_name
        ).first()
        if user_config is None:
            return {}
        return dict(user_config.config)

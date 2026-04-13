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

    ROLE_PRIORITY: dict[str, int] = {"user": 0, "admin": 1, "root": 2}

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
    def can_delete_job(actor: AbstractUser, job: ScientificJob) -> bool:
        if job.deleted_at is not None:
            # Solo root/admin (con alcance válido) pueden eliminar definitivamente
            # desde la papelera de reciclaje.
            return AuthorizationService.can_restore_job(actor=actor, job=job)
        return AuthorizationService.can_manage_job(actor=actor, job=job)

    @staticmethod
    def can_restore_job(actor: AbstractUser, job: ScientificJob) -> bool:
        if job.deleted_at is None:
            return False
        if AuthorizationService.is_root(actor):
            return True
        if not AuthorizationService.is_admin(actor):
            return False

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        return job.group_id in actor_group_ids

    @staticmethod
    def should_use_hard_delete(actor: AbstractUser, job: ScientificJob) -> bool:
        if AuthorizationService.is_root(actor) or AuthorizationService.is_admin(actor):
            # Root/Admin nunca hacen hard delete en la primera acción;
            # primero envían a papelera para permitir restauración.
            return False
        return job.owner_id == actor.id

    @staticmethod
    def get_visible_jobs(
        actor: AbstractUser, *, include_deleted: bool = False
    ) -> QuerySet[ScientificJob]:
        if AuthorizationService.is_root(actor):
            jobs_queryset = ScientificJob.objects.all()
            if not include_deleted:
                jobs_queryset = jobs_queryset.filter(deleted_at__isnull=True)
            return jobs_queryset.order_by("-created_at")

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        jobs_queryset = ScientificJob.objects.filter(
            Q(owner_id=actor.id) | Q(group_id__in=actor_group_ids)
        )
        if not include_deleted:
            jobs_queryset = jobs_queryset.filter(deleted_at__isnull=True)
        return jobs_queryset.order_by("-created_at")

    @staticmethod
    def get_restorable_jobs(actor: AbstractUser) -> QuerySet[ScientificJob]:
        if AuthorizationService.is_root(actor):
            return ScientificJob.objects.filter(deleted_at__isnull=False).order_by(
                "-deleted_at", "-created_at"
            )
        if not AuthorizationService.is_admin(actor):
            return ScientificJob.objects.none()

        actor_group_ids = AuthorizationService._group_ids_for_user(actor)
        return ScientificJob.objects.filter(
            deleted_at__isnull=False,
            group_id__in=actor_group_ids,
        ).order_by("-deleted_at", "-created_at")

    @staticmethod
    def can_access_app(actor: AbstractUser, app_name: str) -> bool:
        # Root siempre puede acceder a todas las apps sin importar reglas explícitas
        if AuthorizationService.is_root(actor):
            return True

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
    def list_accessible_apps(
        actor: AbstractUser,
        *,
        active_group_id: int | None = None,
    ) -> list[dict[str, object]]:
        """Retorna catálogo de apps con visibilidad resuelta para el actor.

        Si `active_group_id` se provee, el acceso se evalúa estrictamente para
        ese grupo — solo apps con `AppPermission` habilitada para ese grupo (o
        permisos root globales) se marcan como `enabled`. Esto soporta el modo
        de selección de grupo activo en el frontend.
        """
        accessible_apps: list[dict[str, object]] = []

        # Para el filtro estricto por grupo activo usamos solo ese grupo_id.
        # Sin filtro, usamos todos los grupos del actor (comportamiento original).
        if active_group_id is not None:
            effective_group_ids: set[int] = {active_group_id}
        else:
            effective_group_ids = AuthorizationService._group_ids_for_user(actor)

        for definition in ScientificAppRegistry.list_definitions():
            group_rule = AuthorizationService._get_group_app_permission(
                actor_group_ids=effective_group_ids,
                app_name=definition.plugin_name,
            )
            user_rule = AuthorizationService._get_user_app_permission(
                actor_id=actor.id,
                app_name=definition.plugin_name,
            )

            # Root siempre habilitado; de lo contrario evaluar regla del grupo activo.
            if AuthorizationService.is_root(actor):
                is_enabled = True
            elif group_rule is not None:
                is_enabled = bool(group_rule.is_enabled)
            elif user_rule is not None:
                is_enabled = bool(user_rule.is_enabled)
            else:
                # Sin regla explícita: acceso permitido (comportamiento por defecto)
                is_enabled = active_group_id is None

            accessible_apps.append(
                {
                    "app_name": definition.plugin_name,
                    "route_key": definition.api_route_prefix.removesuffix("/jobs"),
                    "api_base_path": definition.api_base_path,
                    "supports_pause_resume": bool(definition.supports_pause_resume),
                    "available_features": list(definition.available_features),
                    "enabled": is_enabled,
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
        role_candidates: list[str] = []
        explicit_role = getattr(actor, "role", "")
        if explicit_role in {"root", "admin", "user"}:
            role_candidates.append(str(explicit_role))

        profile = AuthorizationService._get_identity_profile(actor)
        if profile is not None and profile.role in {"root", "admin", "user"}:
            role_candidates.append(str(profile.role))

        if bool(getattr(actor, "is_superuser", False)):
            role_candidates.append("root")
        elif bool(getattr(actor, "is_staff", False)):
            role_candidates.append("admin")

        if len(role_candidates) == 0:
            return "user"

        return max(
            role_candidates,
            key=lambda current_role: AuthorizationService.ROLE_PRIORITY[current_role],
        )

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

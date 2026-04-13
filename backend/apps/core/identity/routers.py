"""routers.py: Endpoints HTTP de autenticación y perfil del dominio transversal."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status, views
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from ..models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    UserAppConfig,
    UserIdentityProfile,
    WorkGroup,
)
from .schemas import (
    AccessibleScientificAppSerializer,
    AppPermissionSerializer,
    DomainTokenObtainPairSerializer,
    EffectiveAppConfigSerializer,
    GroupAppConfigSerializer,
    GroupMembershipSerializer,
    IdentityBootstrapUserSerializer,
    IdentityUserSummarySerializer,
    IdentityUserUpdateSerializer,
    UserAppConfigSerializer,
    UserProfileSerializer,
    WorkGroupSerializer,
)
from .services import AuthorizationService


def _require_admin_or_root(actor) -> bool:
    return AuthorizationService.is_root(actor) or AuthorizationService.is_admin(actor)


def _is_group_admin(actor, group_id: int) -> bool:
    return AuthorizationService.can_manage_group(actor=actor, group_id=group_id)


@extend_schema(tags=["Auth"])
class DomainTokenObtainPairView(TokenObtainPairView):
    """Endpoint de login JWT con claims de dominio."""

    serializer_class = DomainTokenObtainPairSerializer


@extend_schema(tags=["Auth"])
class DomainTokenRefreshView(TokenRefreshView):
    """Endpoint de refresco JWT."""


@extend_schema(tags=["Auth"])
class CurrentUserProfileView(views.APIView):
    """Devuelve el perfil del usuario autenticado."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserProfileSerializer

    def get(self, request: Request) -> Response:
        serializer = UserProfileSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)


@extend_schema(tags=["Auth"])
class CurrentUserAccessibleAppsView(views.APIView):
    """Expone apps disponibles para el usuario actual con RBAC resuelto.

    Acepta `?group_id=X` para evaluar acceso estrictamente desde el grupo activo.
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AccessibleScientificAppSerializer

    @extend_schema(responses=AccessibleScientificAppSerializer(many=True))
    def get(self, request: Request) -> Response:
        raw_group_id = request.query_params.get("group_id")
        active_group_id: int | None = None
        if raw_group_id is not None:
            try:
                active_group_id = int(raw_group_id)
            except (ValueError, TypeError):
                return Response(
                    {"detail": "group_id debe ser un entero válido."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        payload = AuthorizationService.list_accessible_apps(
            request.user, active_group_id=active_group_id
        )
        serializer = AccessibleScientificAppSerializer(payload, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


@extend_schema(tags=["Auth"])
class CurrentUserAppConfigView(views.APIView):
    """Consulta y actualiza configuración de app del usuario actual."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = EffectiveAppConfigSerializer

    @extend_schema(responses=EffectiveAppConfigSerializer)
    def get(self, request: Request, app_name: str) -> Response:
        payload = AuthorizationService.get_effective_app_config(request.user, app_name)
        serializer = EffectiveAppConfigSerializer(payload)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=UserAppConfigSerializer, responses=UserAppConfigSerializer)
    def patch(self, request: Request, app_name: str) -> Response:
        user_app_config, _ = UserAppConfig.objects.update_or_create(
            user=request.user,
            app_name=app_name,
            defaults={"config": request.data.get("config", {})},
        )
        serializer = UserAppConfigSerializer(user_app_config)
        return Response(serializer.data, status=status.HTTP_200_OK)


@extend_schema(tags=["Identity"])
class IdentityUsersView(views.APIView):
    """Lista usuarios o crea usuarios para administración transversal."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = IdentityUserSummarySerializer

    @extend_schema(responses=IdentityUserSummarySerializer(many=True))
    def get(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para listar usuarios."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user_model = get_user_model()
        users_queryset = user_model.objects.all().order_by("id")
        if AuthorizationService.is_admin(actor) and not AuthorizationService.is_root(
            actor
        ):
            visible_user_ids = [
                user.id
                for user in users_queryset
                if AuthorizationService.can_manage_user(actor, user)
                or user.id == actor.id
            ]
            users_queryset = users_queryset.filter(id__in=visible_user_ids)

        serializer = IdentityUserSummarySerializer(users_queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        request=IdentityBootstrapUserSerializer,
        responses={201: IdentityUserSummarySerializer},
    )
    def post(self, request: Request) -> Response:
        actor = request.user

        # Root puede crear cualquier usuario. Admin puede crear usuarios solo para
        # grupos que administra; el primary_group_id debe ser uno de esos grupos.
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para crear usuarios."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = IdentityBootstrapUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not AuthorizationService.is_root(actor):
            # Admin: valida que el primary_group_id sea un grupo que administra
            primary_group_id = serializer.validated_data.get("primary_group_id")
            if primary_group_id is None:
                return Response(
                    {
                        "detail": "No tienes permisos para crear usuarios sin grupo primario asignado."
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not _is_group_admin(actor, group_id=int(primary_group_id)):
                return Response(
                    {"detail": "Solo puedes crear usuarios en grupos que administras."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Admin no puede crear usuarios root
            requested_role = serializer.validated_data.get("role", "user")
            if requested_role == "root":
                return Response(
                    {"detail": "Los administradores no pueden crear usuarios root."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        created_user = serializer.save()
        output_serializer = IdentityUserSummarySerializer(created_user)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)


_ADMIN_ONLY_FIELDS = {
    "role",
    "account_status",
    "primary_group_id",
    "is_active",
    "is_staff",
}


def _apply_basic_user_fields(target_user, payload: dict) -> list[str]:
    """Aplica campos básicos del usuario (email, nombre, contraseña).

    Retorna la lista de campos que requieren update_fields en save().
    """
    updated_fields: list[str] = []
    basic_mapping: dict[str, str] = {
        "email": "email",
        "first_name": "first_name",
        "last_name": "last_name",
    }
    for payload_key, model_field in basic_mapping.items():
        if payload_key in payload:
            setattr(target_user, model_field, str(payload[payload_key]))
            updated_fields.append(model_field)

    if "password" in payload:
        target_user.set_password(str(payload["password"]))
        updated_fields.append("password")

    return updated_fields


def _apply_admin_identity_fields(
    target_user, profile: UserIdentityProfile, payload: dict
) -> None:
    """Aplica campos administrativos de identidad (rol, status, grupo, flags)."""
    _apply_role_from_payload(target_user=target_user, profile=profile, payload=payload)
    _apply_account_status_from_payload(
        target_user=target_user,
        profile=profile,
        payload=payload,
    )
    _apply_primary_group_from_payload(profile=profile, payload=payload)
    _apply_is_active_from_payload(
        target_user=target_user, profile=profile, payload=payload
    )
    _apply_is_staff_from_payload(
        target_user=target_user, profile=profile, payload=payload
    )


def _apply_role_from_payload(
    target_user, profile: UserIdentityProfile, payload: dict
) -> None:
    """Actualiza rol canónico y flags asociados cuando el payload lo incluye."""
    if "role" in payload:
        role_value = str(payload["role"])
        profile.role = role_value
        if hasattr(target_user, "role"):
            target_user.role = role_value
        target_user.is_superuser = role_value == UserIdentityProfile.ROLE_ROOT
        target_user.is_staff = role_value in {
            UserIdentityProfile.ROLE_ROOT,
            UserIdentityProfile.ROLE_ADMIN,
        }


def _apply_account_status_from_payload(
    target_user,
    profile: UserIdentityProfile,
    payload: dict,
) -> None:
    """Actualiza account_status explícito y sincroniza flag activo."""
    if "account_status" in payload:
        profile.account_status = str(payload["account_status"])
        if hasattr(target_user, "account_status"):
            target_user.account_status = profile.account_status
        target_user.is_active = (
            profile.account_status == UserIdentityProfile.STATUS_ACTIVE
        )


def _apply_primary_group_from_payload(
    profile: UserIdentityProfile, payload: dict
) -> None:
    """Actualiza grupo primario cuando es provisto por administración."""
    if "primary_group_id" in payload:
        profile.primary_group_id = payload["primary_group_id"]


def _apply_is_active_from_payload(
    target_user,
    profile: UserIdentityProfile,
    payload: dict,
) -> None:
    """Actualiza estado activo y refleja account_status equivalente."""
    if "is_active" in payload:
        target_user.is_active = bool(payload["is_active"])
        profile.account_status = (
            UserIdentityProfile.STATUS_ACTIVE
            if target_user.is_active
            else UserIdentityProfile.STATUS_INACTIVE
        )
        if hasattr(target_user, "account_status"):
            target_user.account_status = profile.account_status


def _apply_is_staff_from_payload(
    target_user,
    profile: UserIdentityProfile,
    payload: dict,
) -> None:
    """Actualiza staff y promueve rol mínimo admin cuando corresponde."""
    if "is_staff" in payload:
        target_user.is_staff = bool(payload["is_staff"])
        if target_user.is_staff and profile.role == UserIdentityProfile.ROLE_USER:
            profile.role = UserIdentityProfile.ROLE_ADMIN
            if hasattr(target_user, "role"):
                target_user.role = profile.role


@extend_schema(tags=["Identity"])
class IdentityUserDetailView(views.APIView):
    """Actualiza o elimina identidad y estado administrativo de un usuario."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = IdentityUserSummarySerializer

    @extend_schema(
        request=IdentityUserUpdateSerializer,
        responses={200: IdentityUserSummarySerializer},
    )
    def patch(self, request: Request, user_id: int) -> Response:
        actor = request.user
        user_model = get_user_model()
        target_user = get_object_or_404(user_model, id=user_id)
        is_self_update = actor.id == target_user.id
        if not is_self_update and not AuthorizationService.can_manage_user(
            actor=actor, target=target_user
        ):
            return Response(
                {"detail": "No tienes permisos para administrar este usuario."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = IdentityUserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        if is_self_update and not _require_admin_or_root(actor):
            requested_admin_fields = _ADMIN_ONLY_FIELDS.intersection(payload.keys())
            if len(requested_admin_fields) > 0:
                return Response(
                    {
                        "detail": "No tienes permisos para actualizar campos administrativos de tu usuario."
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        profile, _ = UserIdentityProfile.objects.get_or_create(user=target_user)

        basic_updated_fields = _apply_basic_user_fields(target_user, payload)
        _apply_admin_identity_fields(target_user, profile, payload)

        try:
            with transaction.atomic():
                profile.save()

                admin_update_fields = ["is_superuser", "is_staff", "is_active"]
                if hasattr(target_user, "role"):
                    admin_update_fields.append("role")
                if hasattr(target_user, "account_status"):
                    admin_update_fields.append("account_status")
                combined_user_update_fields = list(
                    dict.fromkeys([*basic_updated_fields, *admin_update_fields])
                )
                target_user.save(update_fields=combined_user_update_fields)
        except ValidationError as error:
            error_message = (
                error.messages[0]
                if hasattr(error, "messages") and len(error.messages) > 0
                else "No se pudo actualizar el usuario."
            )
            return Response(
                {"detail": error_message},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response_serializer = IdentityUserSummarySerializer(target_user)
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, user_id: int) -> Response:
        """Elimina un usuario del sistema. Solo root puede eliminar."""
        actor = request.user
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede eliminar usuarios."},
                status=status.HTTP_403_FORBIDDEN,
            )
        user_model = get_user_model()
        target_user = get_object_or_404(user_model, id=user_id)
        if actor.id == target_user.id:
            return Response(
                {"detail": "No puedes eliminar tu propio usuario."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        target_user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["Identity"])
class WorkGroupsView(views.APIView):
    """CRUD parcial para grupos de trabajo del dominio transversal."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WorkGroupSerializer

    @extend_schema(responses=WorkGroupSerializer(many=True))
    def get(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para listar grupos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = WorkGroup.objects.all().order_by("name")
        if AuthorizationService.is_admin(actor) and not AuthorizationService.is_root(
            actor
        ):
            admin_group_ids = GroupMembership.objects.filter(
                user_id=actor.id,
                role_in_group=GroupMembership.ROLE_ADMIN,
            ).values_list("group_id", flat=True)
            queryset = queryset.filter(id__in=admin_group_ids)

        serializer = WorkGroupSerializer(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=WorkGroupSerializer, responses={201: WorkGroupSerializer})
    def post(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para crear grupos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Solo root puede crear grupos; admins gestionan grupos existentes
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede crear nuevos grupos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = WorkGroupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(created_by=actor)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema(tags=["Identity"])
class WorkGroupDetailView(views.APIView):
    """Actualiza o elimina grupos de trabajo con control RBAC."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WorkGroupSerializer

    @extend_schema(request=WorkGroupSerializer, responses={200: WorkGroupSerializer})
    def patch(self, request: Request, group_id: int) -> Response:
        actor = request.user
        group = get_object_or_404(WorkGroup, id=group_id)
        if not _is_group_admin(actor, group_id=group.id):
            return Response(
                {"detail": "No tienes permisos para actualizar este grupo."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = WorkGroupSerializer(group, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, group_id: int) -> Response:
        actor = request.user
        group = get_object_or_404(WorkGroup, id=group_id)
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede eliminar grupos."},
                status=status.HTTP_403_FORBIDDEN,
            )
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["Identity"])
class GroupMembershipsView(views.APIView):
    """Lista y crea membresías de grupos con validaciones de alcance."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = GroupMembershipSerializer

    @extend_schema(responses=GroupMembershipSerializer(many=True))
    def get(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para listar membresías."},
                status=status.HTTP_403_FORBIDDEN,
            )

        memberships_queryset = GroupMembership.objects.all().order_by("id")
        if AuthorizationService.is_admin(actor) and not AuthorizationService.is_root(
            actor
        ):
            admin_group_ids = GroupMembership.objects.filter(
                user_id=actor.id,
                role_in_group=GroupMembership.ROLE_ADMIN,
            ).values_list("group_id", flat=True)
            memberships_queryset = memberships_queryset.filter(
                group_id__in=admin_group_ids
            )

        serializer = GroupMembershipSerializer(memberships_queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        request=GroupMembershipSerializer,
        responses={201: GroupMembershipSerializer},
    )
    def post(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para crear membresías."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = GroupMembershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_group_id = int(serializer.validated_data["group"].id)
        if not _is_group_admin(actor, group_id=target_group_id):
            return Response(
                {"detail": "No puedes administrar membresías de este grupo."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema(tags=["Identity"])
class GroupMembershipDetailView(views.APIView):
    """Actualiza o elimina membresías de grupo."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = GroupMembershipSerializer

    @extend_schema(
        request=GroupMembershipSerializer,
        responses={200: GroupMembershipSerializer},
    )
    def patch(self, request: Request, membership_id: int) -> Response:
        actor = request.user
        membership = get_object_or_404(GroupMembership, id=membership_id)
        if not _is_group_admin(actor, group_id=membership.group_id):
            return Response(
                {"detail": "No tienes permisos para actualizar esta membresía."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = GroupMembershipSerializer(
            membership,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, membership_id: int) -> Response:
        actor = request.user
        membership = get_object_or_404(GroupMembership, id=membership_id)
        if not _is_group_admin(actor, group_id=membership.group_id):
            return Response(
                {"detail": "No tienes permisos para eliminar esta membresía."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Validar invariante: el grupo debe tener al menos un admin tras la eliminación
        if membership.role_in_group == GroupMembership.ROLE_ADMIN:
            admin_count = GroupMembership.objects.filter(
                group_id=membership.group_id,
                role_in_group=GroupMembership.ROLE_ADMIN,
            ).count()
            if admin_count <= 1:
                return Response(
                    {
                        "detail": (
                            "No se puede eliminar la membresía: el grupo debe tener "
                            "al menos un administrador. Asigna otro administrador primero."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["Identity"])
class AppPermissionsView(views.APIView):
    """Lista y crea reglas de acceso por app para usuarios o grupos."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AppPermissionSerializer

    @extend_schema(responses=AppPermissionSerializer(many=True))
    def get(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para listar reglas de acceso."},
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = AppPermission.objects.all().order_by("-updated_at")
        serializer = AppPermissionSerializer(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        request=AppPermissionSerializer,
        responses={201: AppPermissionSerializer},
    )
    def post(self, request: Request) -> Response:
        actor = request.user
        if not _require_admin_or_root(actor):
            return Response(
                {"detail": "No tienes permisos para crear reglas de acceso por app."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Solo root puede crear reglas nuevas; admin puede consultar listado,
        # pero no emitir nuevas reglas globales de acceso.
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede crear reglas de acceso por app."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = AppPermissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema(tags=["Identity"])
class AppPermissionDetailView(views.APIView):
    """Actualiza o elimina reglas de acceso de una app."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AppPermissionSerializer

    @extend_schema(
        request=AppPermissionSerializer,
        responses={200: AppPermissionSerializer},
    )
    def patch(self, request: Request, permission_id: int) -> Response:
        actor = request.user
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede actualizar reglas de acceso por app."},
                status=status.HTTP_403_FORBIDDEN,
            )
        permission = get_object_or_404(AppPermission, id=permission_id)
        serializer = AppPermissionSerializer(
            permission, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, permission_id: int) -> Response:
        actor = request.user
        if not AuthorizationService.is_root(actor):
            return Response(
                {"detail": "Solo root puede eliminar reglas de acceso por app."},
                status=status.HTTP_403_FORBIDDEN,
            )
        permission = get_object_or_404(AppPermission, id=permission_id)
        permission.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["Identity"])
class GroupAppConfigDetailView(views.APIView):
    """Consulta y actualiza configuración de app a nivel de grupo."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = GroupAppConfigSerializer

    @extend_schema(responses=GroupAppConfigSerializer)
    def get(self, request: Request, group_id: int, app_name: str) -> Response:
        actor = request.user
        if not AuthorizationService.can_manage_group(actor=actor, group_id=group_id):
            return Response(
                {
                    "detail": "No tienes permisos para ver la configuración de este grupo."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        group_app_config = GroupAppConfig.objects.filter(
            group_id=group_id,
            app_name=app_name,
        ).first()
        if group_app_config is None:
            return Response(
                {"group": group_id, "app_name": app_name, "config": {}},
                status=status.HTTP_200_OK,
            )

        serializer = GroupAppConfigSerializer(group_app_config)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        request=GroupAppConfigSerializer,
        responses={200: GroupAppConfigSerializer},
    )
    def patch(self, request: Request, group_id: int, app_name: str) -> Response:
        actor = request.user
        if not AuthorizationService.can_manage_group(actor=actor, group_id=group_id):
            return Response(
                {
                    "detail": "No tienes permisos para configurar esta app para el grupo."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        group_app_config, _ = GroupAppConfig.objects.update_or_create(
            group_id=group_id,
            app_name=app_name,
            defaults={"config": request.data.get("config", {})},
        )
        serializer = GroupAppConfigSerializer(group_app_config)
        return Response(serializer.data, status=status.HTTP_200_OK)

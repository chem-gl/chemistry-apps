"""schemas.py: Contratos REST del dominio transversal de identidad.

Define serializadores para autenticación y lectura de perfil de usuario.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from ..app_registry import ScientificAppRegistry
from ..models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    UserAppConfig,
    UserIdentityProfile,
    WorkGroup,
)


def _load_user_memberships(user_id: int) -> list[dict[str, object]]:
    """Carga las membresías de grupo del usuario en una sola query."""
    memberships = (
        GroupMembership.objects.filter(user_id=user_id)
        .select_related("group")
        .order_by("group__name")
    )
    return [
        {
            "group_id": m.group_id,
            "group_name": m.group.name,
            "group_slug": m.group.slug,
            "role_in_group": m.role_in_group,
        }
        for m in memberships
    ]


def _load_profile(user_id: int) -> UserIdentityProfile | None:
    """Carga el perfil de identidad del usuario en una sola query."""
    return UserIdentityProfile.objects.filter(user_id=user_id).first()


def _resolve_user_role(user, profile: UserIdentityProfile | None = None) -> str:
    """Resuelve el rol efectivo del usuario por prioridad."""
    role_priority: dict[str, int] = {"user": 0, "admin": 1, "root": 2}
    role_candidates: list[str] = []

    explicit_role = getattr(user, "role", "")
    if explicit_role in {"root", "admin", "user"}:
        role_candidates.append(str(explicit_role))

    resolved_profile = profile if profile is not None else _load_profile(user.id)
    if resolved_profile is not None and resolved_profile.role in {
        "root",
        "admin",
        "user",
    }:
        role_candidates.append(str(resolved_profile.role))

    if bool(getattr(user, "is_superuser", False)):
        role_candidates.append("root")
    elif bool(getattr(user, "is_staff", False)):
        role_candidates.append("admin")

    if len(role_candidates) == 0:
        return "user"

    return max(role_candidates, key=lambda current_role: role_priority[current_role])


def _resolve_account_status(user, profile: UserIdentityProfile | None) -> str:
    """Resuelve el estado de cuenta del usuario con un perfil ya cargado."""
    explicit_status = getattr(user, "account_status", "")
    if explicit_status in {"active", "inactive"}:
        return str(explicit_status)
    if profile is not None:
        return profile.account_status
    return "active" if bool(getattr(user, "is_active", True)) else "inactive"


def _build_user_representation(
    instance,
    profile: UserIdentityProfile | None,
) -> dict[str, object]:
    """Construye el dict de representación del usuario usando un perfil ya cargado."""
    role = _resolve_user_role(instance, profile)
    account_status = _resolve_account_status(instance, profile)

    primary_group_id: int | None
    explicit_pg = getattr(instance, "primary_group_id", None)
    if explicit_pg is not None:
        primary_group_id = int(explicit_pg)
    elif profile is not None:
        primary_group_id = profile.primary_group_id
    else:
        primary_group_id = None

    avatar: str
    explicit_avatar = getattr(instance, "avatar", None)
    if isinstance(explicit_avatar, str):
        avatar = explicit_avatar
    elif profile is not None:
        avatar = profile.avatar
    else:
        avatar = ""

    email_verified: bool
    explicit_ev = getattr(instance, "email_verified", None)
    if isinstance(explicit_ev, bool):
        email_verified = explicit_ev
    elif profile is not None:
        email_verified = bool(profile.email_verified)
    else:
        email_verified = False

    updated_at = profile.updated_at if profile is not None else None

    return {
        "id": instance.id,
        "username": instance.username,
        "email": instance.email,
        "role": role,
        "account_status": account_status,
        "first_name": instance.first_name,
        "last_name": instance.last_name,
        "avatar": avatar,
        "email_verified": email_verified,
        "primary_group_id": primary_group_id,
        "created_at": getattr(instance, "date_joined", None),
        "updated_at": updated_at,
    }


class UserMembershipSummarySerializer(serializers.Serializer):
    """Serializer de resumen de membresía de grupo para el perfil del usuario."""

    group_id = serializers.IntegerField(read_only=True)
    group_name = serializers.CharField(read_only=True)
    group_slug = serializers.CharField(read_only=True)
    role_in_group = serializers.CharField(read_only=True)


class UserProfileSerializer(serializers.Serializer):
    """Serializer de lectura para perfil del usuario autenticado. Incluye membresías."""

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)
    email = serializers.EmailField(read_only=True)
    role = serializers.CharField(read_only=True)
    account_status = serializers.CharField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    avatar = serializers.CharField(read_only=True)
    email_verified = serializers.BooleanField(read_only=True)
    primary_group_id = serializers.IntegerField(read_only=True, allow_null=True)
    created_at = serializers.DateTimeField(read_only=True, allow_null=True)
    updated_at = serializers.DateTimeField(read_only=True, allow_null=True)
    memberships = UserMembershipSummarySerializer(many=True, read_only=True)

    def to_representation(self, instance):
        profile = _load_profile(instance.id)
        base = _build_user_representation(instance, profile)
        base["memberships"] = _load_user_memberships(instance.id)
        return base


class DomainTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Extiende claims JWT con rol y grupo primario."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        profile = _load_profile(user.id)
        token["role"] = _resolve_user_role(user, profile)
        token["group_id"] = profile.primary_group_id if profile is not None else None
        token["user_id"] = str(user.id)
        return token


class IdentityUserSummarySerializer(serializers.Serializer):
    """Serializer resumido para listar usuarios en panel administrativo."""

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)
    email = serializers.EmailField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    is_staff = serializers.BooleanField(read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)
    role = serializers.CharField(read_only=True)
    account_status = serializers.CharField(read_only=True)
    primary_group_id = serializers.IntegerField(read_only=True, allow_null=True)

    def to_representation(self, instance):
        profile = _load_profile(instance.id)
        return {
            "id": instance.id,
            "username": instance.username,
            "email": instance.email,
            "first_name": instance.first_name,
            "last_name": instance.last_name,
            "is_active": bool(instance.is_active),
            "is_staff": bool(instance.is_staff),
            "is_superuser": bool(instance.is_superuser),
            "role": _resolve_user_role(instance, profile),
            "account_status": _resolve_account_status(instance, profile),
            "primary_group_id": profile.primary_group_id
            if profile is not None
            else None,
        }


class IdentityUserUpdateSerializer(serializers.Serializer):
    """Serializer de actualización de perfil/estado de usuario para administración."""

    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)

    role = serializers.ChoiceField(
        choices=UserIdentityProfile.ROLE_CHOICES,
        required=False,
    )
    account_status = serializers.ChoiceField(
        choices=UserIdentityProfile.STATUS_CHOICES,
        required=False,
    )
    primary_group_id = serializers.IntegerField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
    is_staff = serializers.BooleanField(required=False)

    def validate_primary_group_id(self, value: int | None) -> int | None:
        if value is None:
            return None
        if not WorkGroup.objects.filter(id=value).exists():
            raise serializers.ValidationError("El grupo primario indicado no existe.")
        return value


class WorkGroupSerializer(serializers.ModelSerializer):
    """Serializer CRUD para grupos de trabajo."""

    class Meta:
        model = WorkGroup
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]


class GroupMembershipSerializer(serializers.ModelSerializer):
    """Serializer CRUD para membresías de grupo."""

    class Meta:
        model = GroupMembership
        fields = ["id", "user", "group", "role_in_group", "joined_at"]
        read_only_fields = ["joined_at"]


class AppPermissionSerializer(serializers.ModelSerializer):
    """Serializer CRUD para permisos de app por usuario o por grupo."""

    class Meta:
        model = AppPermission
        fields = [
            "id",
            "app_name",
            "group",
            "user",
            "is_enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        validators = []

    def get_validators(self):
        """Desactiva validadores automáticos para manejar PATCH parcial sin KeyError."""
        return []

    def validate(self, attrs: dict):
        # En actualizaciones parciales, considerar valores de la instancia existente
        group_value = attrs.get("group", getattr(self.instance, "group", None))
        user_value = attrs.get("user", getattr(self.instance, "user", None))
        app_name_value = attrs.get("app_name", getattr(self.instance, "app_name", ""))
        resolved_definition = ScientificAppRegistry.resolve_definition(
            str(app_name_value)
        )

        if group_value is None and user_value is None:
            raise serializers.ValidationError(
                "Debes indicar un usuario o un grupo para la regla de acceso."
            )
        if group_value is not None and user_value is not None:
            raise serializers.ValidationError(
                "La regla de acceso debe estar asociada a usuario o a grupo, no a ambos."
            )

        if resolved_definition is None:
            raise serializers.ValidationError(
                {"app_name": "La app indicada no está registrada en el sistema."}
            )

        attrs["app_name"] = resolved_definition.plugin_name
        app_name_value = resolved_definition.plugin_name

        # Valida unicidad por sujeto+app de forma explícita para evitar ambigüedad.
        duplicated_permission_query = AppPermission.objects.filter(
            app_name=app_name_value
        )
        if self.instance is not None:
            duplicated_permission_query = duplicated_permission_query.exclude(
                id=self.instance.id
            )

        if (
            group_value is not None
            and duplicated_permission_query.filter(
                group=group_value, user__isnull=True
            ).exists()
        ):
            raise serializers.ValidationError(
                "Ya existe una regla para este grupo y app."
            )

        if (
            user_value is not None
            and duplicated_permission_query.filter(
                user=user_value, group__isnull=True
            ).exists()
        ):
            raise serializers.ValidationError(
                "Ya existe una regla para este usuario y app."
            )

        return attrs


class IdentityBootstrapUserSerializer(serializers.Serializer):
    """Serializer de creación de usuarios para panel administrativo."""

    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=UserIdentityProfile.ROLE_CHOICES)
    account_status = serializers.ChoiceField(
        choices=UserIdentityProfile.STATUS_CHOICES,
        required=False,
        default=UserIdentityProfile.STATUS_ACTIVE,
    )
    primary_group_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_primary_group_id(self, value: int | None) -> int | None:
        if value is None:
            return None
        if not WorkGroup.objects.filter(id=value).exists():
            raise serializers.ValidationError("El grupo primario indicado no existe.")
        return value

    def validate(self, attrs: dict) -> dict:
        role_value = str(attrs.get("role", UserIdentityProfile.ROLE_USER))
        primary_group_id = attrs.get("primary_group_id")
        if role_value != UserIdentityProfile.ROLE_ROOT and primary_group_id is None:
            raise serializers.ValidationError(
                {
                    "primary_group_id": (
                        "Todo usuario no root debe crearse con un grupo primario."
                    )
                }
            )
        return attrs

    def create(self, validated_data: dict):
        user_model = get_user_model()
        role_value = str(validated_data.pop("role"))
        account_status = str(
            validated_data.pop("account_status", UserIdentityProfile.STATUS_ACTIVE)
        )
        primary_group_id = validated_data.pop("primary_group_id", None)
        raw_password = str(validated_data.pop("password"))

        with transaction.atomic():
            created_user = user_model.objects.create_user(
                username=validated_data["username"],
                email=validated_data.get("email", ""),
                password=raw_password,
                first_name=validated_data.get("first_name", ""),
                last_name=validated_data.get("last_name", ""),
                role=role_value,
                account_status=account_status,
            )
            created_user.save()

            UserIdentityProfile.objects.update_or_create(
                user=created_user,
                defaults={
                    "role": role_value,
                    "account_status": account_status,
                    "primary_group_id": primary_group_id,
                },
            )

            if primary_group_id is not None:
                default_membership_role = (
                    GroupMembership.ROLE_ADMIN
                    if role_value
                    in {
                        UserIdentityProfile.ROLE_ADMIN,
                        UserIdentityProfile.ROLE_ROOT,
                    }
                    else GroupMembership.ROLE_MEMBER
                )
                GroupMembership.objects.update_or_create(
                    user=created_user,
                    group_id=primary_group_id,
                    defaults={"role_in_group": default_membership_role},
                )
        return created_user


class AccessibleScientificAppSerializer(serializers.Serializer):
    """Serializer de apps visibles para el usuario actual. Incluye features disponibles."""

    app_name = serializers.CharField(read_only=True)
    route_key = serializers.CharField(read_only=True)
    api_base_path = serializers.CharField(read_only=True)
    supports_pause_resume = serializers.BooleanField(read_only=True)
    available_features = serializers.ListField(
        child=serializers.CharField(), read_only=True
    )
    enabled = serializers.BooleanField(read_only=True)
    group_permission = serializers.BooleanField(read_only=True, allow_null=True)
    user_permission = serializers.BooleanField(read_only=True, allow_null=True)


class ScientificAppCatalogSerializer(serializers.Serializer):
    """Serializer del catálogo canónico de apps científicas registradas."""

    plugin_name = serializers.CharField(read_only=True)
    route_key = serializers.CharField(read_only=True)
    api_base_path = serializers.CharField(read_only=True)
    supports_pause_resume = serializers.BooleanField(read_only=True)
    available_features = serializers.ListField(
        child=serializers.CharField(), read_only=True
    )


class EffectiveAppConfigSerializer(serializers.Serializer):
    """Serializer de configuración resuelta para una app."""

    app_name = serializers.CharField(read_only=True)
    enabled = serializers.BooleanField(read_only=True)
    effective_config = serializers.JSONField(read_only=True)
    group_config = serializers.JSONField(read_only=True)
    user_config = serializers.JSONField(read_only=True)


class UserAppConfigSerializer(serializers.ModelSerializer):
    """Serializer CRUD para configuración de app por usuario."""

    class Meta:
        model = UserAppConfig
        fields = ["id", "user", "app_name", "config", "updated_at"]
        read_only_fields = ["updated_at"]


class GroupAppConfigSerializer(serializers.ModelSerializer):
    """Serializer CRUD para configuración de app por grupo."""

    class Meta:
        model = GroupAppConfig
        fields = ["id", "group", "app_name", "config", "updated_at"]
        read_only_fields = ["updated_at"]

"""schemas.py: Contratos REST del dominio transversal de identidad.

Define serializadores para autenticación y lectura de perfil de usuario.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from ..models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    UserAppConfig,
    UserIdentityProfile,
    WorkGroup,
)


def _resolve_user_role(user) -> str:
    explicit_role = getattr(user, "role", "")
    if explicit_role in {"root", "admin", "user"}:
        return str(explicit_role)

    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is not None and identity_profile.role in {
        "root",
        "admin",
        "user",
    }:
        return str(identity_profile.role)

    if bool(getattr(user, "is_superuser", False)):
        return "root"
    if bool(getattr(user, "is_staff", False)):
        return "admin"
    return "user"


def _resolve_primary_group_id(user) -> int | None:
    explicit_primary_group_id = getattr(user, "primary_group_id", None)
    if explicit_primary_group_id is not None:
        return int(explicit_primary_group_id)

    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is None:
        return None
    return identity_profile.primary_group_id


def _resolve_account_status(user) -> str:
    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is not None:
        return identity_profile.account_status
    return "active" if bool(getattr(user, "is_active", True)) else "inactive"


def _resolve_avatar(user) -> str:
    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is None:
        return ""
    return identity_profile.avatar


def _resolve_email_verified(user) -> bool:
    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is None:
        return False
    return bool(identity_profile.email_verified)


def _resolve_updated_at(user):
    identity_profile = UserIdentityProfile.objects.filter(user_id=user.id).first()
    if identity_profile is None:
        return None
    return identity_profile.updated_at


class UserProfileSerializer(serializers.Serializer):
    """Serializer de lectura para perfil del usuario autenticado."""

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

    def to_representation(self, instance):
        return {
            "id": instance.id,
            "username": instance.username,
            "email": instance.email,
            "role": _resolve_user_role(instance),
            "account_status": _resolve_account_status(instance),
            "first_name": instance.first_name,
            "last_name": instance.last_name,
            "avatar": _resolve_avatar(instance),
            "email_verified": _resolve_email_verified(instance),
            "primary_group_id": _resolve_primary_group_id(instance),
            "created_at": getattr(instance, "date_joined", None),
            "updated_at": _resolve_updated_at(instance),
        }


class DomainTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Extiende claims JWT con rol y grupo primario."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = _resolve_user_role(user)
        token["group_id"] = _resolve_primary_group_id(user)
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
        return {
            "id": instance.id,
            "username": instance.username,
            "email": instance.email,
            "first_name": instance.first_name,
            "last_name": instance.last_name,
            "is_active": bool(instance.is_active),
            "is_staff": bool(instance.is_staff),
            "is_superuser": bool(instance.is_superuser),
            "role": _resolve_user_role(instance),
            "account_status": _resolve_account_status(instance),
            "primary_group_id": _resolve_primary_group_id(instance),
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

    def validate(self, attrs: dict):
        # En actualizaciones parciales, considerar valores de la instancia existente
        group_value = attrs.get("group", getattr(self.instance, "group", None))
        user_value = attrs.get("user", getattr(self.instance, "user", None))
        if group_value is None and user_value is None:
            raise serializers.ValidationError(
                "Debes indicar un usuario o un grupo para la regla de acceso."
            )
        if group_value is not None and user_value is not None:
            raise serializers.ValidationError(
                "La regla de acceso debe estar asociada a usuario o a grupo, no a ambos."
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

    def create(self, validated_data: dict):
        user_model = get_user_model()
        role_value = str(validated_data.pop("role"))
        account_status = str(
            validated_data.pop("account_status", UserIdentityProfile.STATUS_ACTIVE)
        )
        primary_group_id = validated_data.pop("primary_group_id", None)
        raw_password = str(validated_data.pop("password"))

        created_user = user_model.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=raw_password,
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        created_user.is_superuser = role_value == UserIdentityProfile.ROLE_ROOT
        created_user.is_staff = role_value in {
            UserIdentityProfile.ROLE_ROOT,
            UserIdentityProfile.ROLE_ADMIN,
        }
        created_user.is_active = account_status == UserIdentityProfile.STATUS_ACTIVE
        created_user.save(update_fields=["is_superuser", "is_staff", "is_active"])

        UserIdentityProfile.objects.update_or_create(
            user=created_user,
            defaults={
                "role": role_value,
                "account_status": account_status,
                "primary_group_id": primary_group_id,
            },
        )
        return created_user


class AccessibleScientificAppSerializer(serializers.Serializer):
    """Serializer de apps visibles para el usuario actual."""

    app_name = serializers.CharField(read_only=True)
    route_key = serializers.CharField(read_only=True)
    api_base_path = serializers.CharField(read_only=True)
    supports_pause_resume = serializers.BooleanField(read_only=True)
    enabled = serializers.BooleanField(read_only=True)
    group_permission = serializers.BooleanField(read_only=True, allow_null=True)
    user_permission = serializers.BooleanField(read_only=True, allow_null=True)


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

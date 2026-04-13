"""models.py: Modelo de usuario personalizado para identidad canónica.

Objetivo del archivo:
- Definir la entidad UserAccount como AUTH_USER_MODEL único del dominio.

Cómo se usa:
- Django auth y DRF autentican contra UserAccount.
- Reemplaza progresivamente atributos duplicados en perfiles auxiliares.
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models


class UserAccount(AbstractUser):
    """Usuario autenticable con atributos de identidad de dominio."""

    ROLE_ROOT = "root"
    ROLE_ADMIN = "admin"
    ROLE_USER = "user"
    ROLE_CHOICES: list[tuple[str, str]] = [
        (ROLE_ROOT, "Root"),
        (ROLE_ADMIN, "Admin"),
        (ROLE_USER, "User"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"
    STATUS_CHOICES: list[tuple[str, str]] = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_USER)
    account_status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
    )
    avatar = models.TextField(blank=True, default="")
    email_verified = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]

    def _validate_last_active_root_invariant(self) -> None:
        """Evita dejar el sistema sin usuarios root activos.

        La validación se ejecuta solo en actualización de un root activo existente
        cuando el estado final lo convertiría en no-root o inactivo.
        """
        if self.pk is None:
            return

        previous_state = (
            UserAccount.objects.filter(pk=self.pk)
            .values("role", "account_status")
            .first()
        )
        if previous_state is None:
            return

        was_active_root = (
            previous_state["role"] == self.ROLE_ROOT
            and previous_state["account_status"] == self.STATUS_ACTIVE
        )
        will_be_active_root = (
            self.role == self.ROLE_ROOT and self.account_status == self.STATUS_ACTIVE
        )

        if not was_active_root or will_be_active_root:
            return

        other_active_roots_exist = (
            UserAccount.objects.filter(
                role=self.ROLE_ROOT,
                account_status=self.STATUS_ACTIVE,
            )
            .exclude(pk=self.pk)
            .exists()
        )
        if other_active_roots_exist:
            return

        raise ValidationError(
            "No se puede desactivar o degradar el ultimo usuario root activo."
        )

    def save(self, *args, **kwargs):
        """Sincroniza flags Django con rol/estado de dominio antes de persistir."""
        if self.is_superuser:
            self.role = self.ROLE_ROOT
        elif self.is_staff and self.role == self.ROLE_USER:
            self.role = self.ROLE_ADMIN

        if not self.is_active:
            self.account_status = self.STATUS_INACTIVE
        elif self.account_status == self.STATUS_INACTIVE:
            self.account_status = self.STATUS_ACTIVE

        self.is_superuser = self.role == self.ROLE_ROOT
        self.is_staff = self.role in {self.ROLE_ROOT, self.ROLE_ADMIN}
        self.is_active = self.account_status == self.STATUS_ACTIVE
        self._validate_last_active_root_invariant()
        return super().save(*args, **kwargs)

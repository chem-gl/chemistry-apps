"""bootstrap/__init__.py: Utilidades de inicialización del dominio de identidad."""

from .root_user import ensure_root_user
from .superadmin_group import ensure_superadmin_group

__all__ = ["ensure_root_user", "ensure_superadmin_group"]

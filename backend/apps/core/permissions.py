"""permissions.py: Sistema genérico de permisos multinivel para todas las apps científicas.

Objetivo del archivo:
- Proveer funciones compartidas para validar permisos de vista, edición y eliminación
  basados en source_reference (user/admin/root/seed).
- Independiente de cualquier modelo específico: funciona con cualquier objeto con
  `source_reference` y `provenance_metadata`.

Cómo se usa:
- `apps.smileit.catalog` y otras apps importan estas funciones.
- Validar permisos en endpoints antes de permitir mutaciones.
- El sistema asume que los roles son: "root", "admin", "user" (en UserAccount.role).
"""

from __future__ import annotations


def get_entry_source_reference(entry: object) -> str:
    """Obtiene el tipo de fuente de una entrada (user/admin/root/seed).

    Asume que entry tiene atributo `source_reference: str`.

    Retorna:
        - "legacy-smileit" o "smileit-seed": Seed entries (no editables)
        - "local-lab": Usuario regular
        - "admin-{group_id}": Creada por admin para su grupo
        - "root": Creada por root
    """
    source_ref = getattr(entry, "source_reference", "").strip().lower()
    return source_ref


def get_entry_owner_group_id(entry: object) -> int | None:
    """Obtiene el ID del grupo propietario si la entrada fue creada por un admin.

    Si `get_entry_source_reference(entry)` retorna "admin-{group_id}",
    extrae y retorna el ID. De lo contrario, retorna None.
    """
    source_ref = get_entry_source_reference(entry)
    if not source_ref.startswith("admin-"):
        return None

    try:
        return int(source_ref.replace("admin-", ""))
    except ValueError:
        return None


def _get_owner_user_id_from_metadata(entry: object) -> int | None:
    """Extrae owner_user_id desde provenance_metadata si existe.

    Helper diseñado para apps que almacenan owner_user_id en metadata.
    """
    metadata = getattr(entry, "provenance_metadata", {})
    if not isinstance(metadata, dict):
        return None

    raw_owner_user_id = metadata.get("owner_user_id")
    if raw_owner_user_id is None:
        return None

    try:
        return int(str(raw_owner_user_id).strip())
    except ValueError:
        return None


def _is_seed_source(source_ref: str) -> bool:
    """Retorna True si el source_reference pertenece a entradas semilla."""
    return source_ref in {"legacy-smileit", "smileit-seed"}


def _is_root_actor(actor_role: str | None, actor_user_id: int | None) -> bool:
    """Retorna True cuando el actor autenticado tiene rol root."""
    return actor_role == "root" and actor_user_id is not None


def _can_edit_user_source(entry: object, actor_user_id: int, actor_role: str) -> bool:
    """Regla de edición para source_reference='local-lab'."""
    if actor_role != "user":
        return False
    owner_user_id = _get_owner_user_id_from_metadata(entry)
    return owner_user_id == actor_user_id


def _can_edit_admin_source(
    entry: object,
    actor_role: str,
    actor_user_groups: list[int] | None,
) -> bool:
    """Regla de edición para source_reference='admin-{group_id}'."""
    if actor_role == "root":
        return True
    if actor_role != "admin":
        return False
    owner_group_id = get_entry_owner_group_id(entry)
    if owner_group_id is None or actor_user_groups is None:
        return False
    return owner_group_id in actor_user_groups


def _can_view_user_source(entry: object, actor_user_id: int | None) -> bool:
    """Regla de visibilidad para entradas `local-lab` (usuario propietario)."""
    if actor_user_id is None:
        return False
    owner_user_id = _get_owner_user_id_from_metadata(entry)
    return owner_user_id == actor_user_id


def _can_view_admin_source(entry: object, actor_user_groups: list[int] | None) -> bool:
    """Regla de visibilidad para entradas `admin-{group_id}` (miembros del grupo)."""
    owner_group_id = get_entry_owner_group_id(entry)
    if owner_group_id is None or actor_user_groups is None:
        return False
    return owner_group_id in actor_user_groups


def can_user_view_entry(
    entry: object,
    actor_user_id: int | None = None,
    actor_user_groups: list[int] | None = None,
    actor_role: str | None = None,
) -> bool:
    """Determina si un usuario puede ver una entrada.

    Reglas:
        - Seed entries (legacy-smileit, smileit-seed): visibles para todos
        - User entries (local-lab): solo para el dueño
        - Admin entries (admin-{group_id}): para usuarios en el grupo
        - Root entries (root): visibles para todos (aunque root puede filtrar)

    Args:
        entry: Entrada con `source_reference` y `provenance_metadata`
        actor_user_id: ID del usuario que intenta ver (None si anónimo)
        actor_user_groups: Lista de IDs de grupos del usuario
        actor_role: Rol del usuario ("root", "admin", "user", o None)
    """
    source_ref = get_entry_source_reference(entry)

    # Seed y root: visibles para todos
    if source_ref in {"legacy-smileit", "smileit-seed", "root"}:
        return True

    # Root autenticado: visibilidad global para cualquier entrada no-seed.
    if _is_root_actor(actor_role, actor_user_id):
        return True

    # No autenticado: solo ver seed y root
    if actor_user_id is None:
        return False

    # User entries: solo el dueño
    if source_ref == "local-lab":
        return _can_view_user_source(entry, actor_user_id)

    # Admin entries: usuarios en el grupo
    if source_ref.startswith("admin-"):
        return _can_view_admin_source(entry, actor_user_groups)

    return False


def can_user_edit_entry(
    entry: object,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_groups: list[int] | None = None,
) -> bool:
    """Determina si un usuario puede editar una entrada.

    Reglas:
        - Seed/Legacy entries: ❌ nunca
        - User entries: ✅ solo el usuario que la creó y si tiene role=user
        - Admin entries: ✅ admins que pertenecen al grupo
        - Root entries: ✅ solo root

    Args:
        entry: Entrada con `source_reference` y `provenance_metadata`
        actor_user_id: ID del usuario
        actor_role: Rol del usuario ("root", "admin", "user", o None)
        actor_user_groups: Lista de IDs de grupos del usuario
    """
    source_ref = get_entry_source_reference(entry)

    if _is_seed_source(source_ref):
        return False

    if actor_user_id is None or actor_role is None:
        return False

    if source_ref == "local-lab":
        return _can_edit_user_source(entry, actor_user_id, actor_role)

    # Root entries: solo root
    if source_ref == "root":
        return actor_role == "root"

    if source_ref.startswith("admin-"):
        return _can_edit_admin_source(entry, actor_role, actor_user_groups)

    return False


def can_user_delete_entry(
    entry: object,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_groups: list[int] | None = None,
) -> bool:
    """Determina si un usuario puede eliminar una entrada.

    Las reglas son idénticas a `can_user_edit_entry()`.
    """
    return can_user_edit_entry(
        entry=entry,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_user_groups,
    )


def get_source_reference_for_role(
    actor_role: str | None = None,
    actor_primary_group_id: int | None = None,
) -> str:
    """Determina el source_reference basado en el rol del usuario.

    Args:
        actor_role: "root", "admin", "user", o None
        actor_primary_group_id: ID del grupo primario si actor_role es "admin"

    Retorna:
        - "root" si actor_role == "root"
        - "admin-{group_id}" si actor_role == "admin"
        - "local-lab" si actor_role == "user"
        - "" si actor_role es None

    Raises:
        ValueError: Si actor_role es "admin" pero actor_primary_group_id es None
    """
    if actor_role == "root":
        return "root"
    if actor_role == "admin":
        if actor_primary_group_id is None:
            raise ValueError("Se requiere el ID del grupo primario para admins.")
        return f"admin-{actor_primary_group_id}"
    if actor_role == "user":
        return "local-lab"
    return ""

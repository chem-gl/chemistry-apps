"""catalog.py: Servicios de catálogo persistente para Smile-it.

Objetivo del archivo:
- Exponer funciones para listar y crear categorías, sustituyentes y patrones
  persistentes con validaciones químicas y anti-duplicado estructural.

Cómo se usa:
- `routers.py` llama estas funciones para CRUD y para resolver bloques.
- `plugin.py` recibe sustituyentes ya resueltos desde el router.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.db import transaction
from rdkit import Chem

from apps.core.permissions import (
    can_user_delete_entry,
    can_user_edit_entry,
    can_user_view_entry,
    get_entry_source_reference,
    get_source_reference_for_role,
)

from .engine import canonicalize_smiles, validate_smarts, verify_substituent_category
from .models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)
from .types import (
    SmileitCatalogEntry,
    SmileitManualSubstituentInput,
    SmileitPatternCreatePayload,
    SmileitPatternEntry,
    SmileitSubstituentCreatePayload,
    SmileitSubstituentReferenceInput,
)
from .types import SmileitCategory as SmileitCategoryType

INVALID_STABLE_ID_MESSAGE = "El stable_id indicado no tiene formato UUID válido."
MISSING_ACTIVE_SUBSTITUENT_MESSAGE = (
    "No existe un sustituyente activo para el stable_id indicado."
)


@dataclass(frozen=True)
class CategoryValidationResult:
    """Resultado de validación para categorías asignadas a un sustituyente."""

    category_key: str
    passed: bool
    message: str


def _is_substituent_user_editable(substituent: SmileitSubstituent) -> bool:
    """Determina si una entrada de catálogo se puede editar desde la UI."""
    source_reference = substituent.source_reference.strip().lower()
    if source_reference in {"legacy-smileit", "smileit-seed"}:
        return False

    seed_flag = substituent.provenance_metadata.get("seed")
    return str(seed_flag).strip().lower() not in {"true", "1", "yes"}


def _normalize_metadata(raw_metadata: dict[str, str]) -> dict[str, str]:
    """Normaliza metadata textual removiendo claves vacías."""
    normalized: dict[str, str] = {}
    for raw_key, raw_value in raw_metadata.items():
        normalized_key = raw_key.strip()
        if normalized_key == "":
            continue
        normalized[normalized_key] = raw_value.strip()
    return normalized


def _serialize_category(category: SmileitCategory) -> SmileitCategoryType:
    """Convierte modelo de categoría a contrato tipado de salida."""
    return SmileitCategoryType(
        id=str(category.id),
        key=category.key,
        version=category.version,
        name=category.name,
        description=category.description,
        verification_rule=category.verification_rule,
        verification_smarts=category.verification_smarts,
    )


def _serialize_substituent(substituent: SmileitSubstituent) -> SmileitCatalogEntry:
    """Convierte modelo persistente a contrato de catálogo Smile-it."""
    category_keys: list[str] = list(
        substituent.categories.order_by("key").values_list("key", flat=True)
    )
    metadata: dict[str, str] = {
        str(meta_key): str(meta_value)
        for meta_key, meta_value in substituent.provenance_metadata.items()
    }
    return SmileitCatalogEntry(
        id=str(substituent.id),
        stable_id=str(substituent.stable_id),
        version=substituent.version,
        name=substituent.name,
        smiles=substituent.smiles_canonical,
        anchor_atom_indices=[int(value) for value in substituent.anchor_atom_indices],
        categories=category_keys,
        source_reference=substituent.source_reference,
        provenance_metadata=metadata,
    )


def _serialize_pattern(pattern: SmileitPattern) -> SmileitPatternEntry:
    """Convierte patrón persistido a contrato tipado de salida."""
    metadata: dict[str, str] = {
        str(meta_key): str(meta_value)
        for meta_key, meta_value in pattern.provenance_metadata.items()
    }
    return SmileitPatternEntry(
        id=str(pattern.id),
        stable_id=str(pattern.stable_id),
        version=pattern.version,
        name=pattern.name,
        smarts=pattern.smarts,
        pattern_type=pattern.pattern_type,
        caption=pattern.caption,
        source_reference=pattern.source_reference,
        provenance_metadata=metadata,
    )


def list_active_categories() -> list[SmileitCategoryType]:
    """Lista categorías activas en su versión más reciente."""
    categories = SmileitCategory.objects.filter(
        is_latest=True, is_active=True
    ).order_by("key")
    return [_serialize_category(entry) for entry in categories]


def list_active_catalog_entries(
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
    filter_mode: str = "show-all",
) -> list[SmileitCatalogEntry]:
    """Lista sustituyentes activos con filtrado por permisos y filtro root.

    Args:
        actor_user_id: ID del usuario actual (None si anónimo)
        actor_role: Rol del usuario ("root", "admin", "user")
        actor_user_group_ids: Lista de IDs de grupos a los que pertenece el usuario
        filter_mode: "show-all" o "root-only". Si "root-only", solo muestra entries del root

    Retorna:
        Lista de sustituyentes que el usuario puede ver
    """
    entries = (
        SmileitSubstituent.objects.filter(is_latest=True, is_active=True)
        .prefetch_related("categories")
        .order_by("name", "stable_id")
    )

    if actor_user_group_ids is None:
        actor_user_group_ids = []

    visible_entries: list[SmileitCatalogEntry] = []
    for entry in entries:
        # Aplicar filtro root-only si está activo y actor es root
        if filter_mode == "root-only" and actor_role == "root":
            if get_entry_source_reference(entry) != "root":
                continue

        # Usar nueva función de permisos
        if can_user_view_entry(
            entry=entry,
            actor_user_id=actor_user_id,
            actor_user_groups=actor_user_group_ids,
            actor_role=actor_role,
        ):
            visible_entries.append(_serialize_substituent(entry))

    return visible_entries


def list_active_patterns(
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
    filter_mode: str = "show-all",
) -> list[SmileitPatternEntry]:
    """Lista patrones estructurales activos con filtrado por permisos.

    Args:
        actor_user_id: ID del usuario actual (None si anónimo)
        actor_role: Rol del usuario ("root", "admin", "user")
        actor_user_group_ids: Lista de IDs de grupos a los que pertenece el usuario
        filter_mode: "show-all" o "root-only". Si "root-only", solo muestra patrones del root

    Retorna:
        Lista de patrones que el usuario puede ver
    """
    patterns = SmileitPattern.objects.filter(is_latest=True, is_active=True).order_by(
        "pattern_type", "name"
    )

    if actor_user_group_ids is None:
        actor_user_group_ids = []

    visible_patterns: list[SmileitPatternEntry] = []
    for pattern in patterns:
        # Aplicar filtro root-only si está activo y actor es root
        if filter_mode == "root-only" and actor_role == "root":
            if get_entry_source_reference(pattern) != "root":
                continue

        # Usar función de permisos
        if can_user_view_entry(
            entry=pattern,
            actor_user_id=actor_user_id,
            actor_user_groups=actor_user_group_ids,
            actor_role=actor_role,
        ):
            visible_patterns.append(_serialize_pattern(pattern))

    return visible_patterns


def get_category_map(keys: list[str]) -> dict[str, SmileitCategory]:
    """Resuelve categorías activas por key para validaciones."""
    unique_keys = sorted({item.strip() for item in keys if item.strip() != ""})
    categories = SmileitCategory.objects.filter(
        is_latest=True,
        is_active=True,
        key__in=unique_keys,
    )
    return {entry.key: entry for entry in categories}


def validate_substituent_categories(
    smiles_canonical: str,
    categories: list[SmileitCategory],
) -> list[CategoryValidationResult]:
    """Valida pertenencia del sustituyente a cada categoría declarada."""
    validations: list[CategoryValidationResult] = []
    for category in categories:
        is_valid, message = verify_substituent_category(
            smiles=smiles_canonical,
            verification_rule=category.verification_rule,
            verification_smarts=category.verification_smarts,
        )
        validations.append(
            CategoryValidationResult(
                category_key=category.key,
                passed=is_valid,
                message=message,
            )
        )
    return validations


def _assert_anchor_indices(smiles: str, anchor_atom_indices: list[int]) -> list[int]:
    """Valida índices de anclaje y retorna lista normalizada ordenada sin repetidos."""
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError("SMILES inválido para validar índices de anclaje.")

    atom_count = molecule.GetNumAtoms()
    if atom_count <= 0:
        raise ValueError("El sustituyente debe contener al menos un átomo.")

    normalized_indices: list[int] = sorted(
        {int(value) for value in anchor_atom_indices}
    )
    if len(normalized_indices) == 0:
        raise ValueError("Debe indicar al menos un índice de anclaje válido.")

    for atom_index in normalized_indices:
        if atom_index < 0 or atom_index >= atom_count:
            raise ValueError(
                "Se detectó un índice de anclaje fuera de rango para el sustituyente."
            )
    return normalized_indices


def _resolve_category_map_or_raise(
    category_keys: list[str],
) -> dict[str, SmileitCategory]:
    """Resuelve categorías activas y valida que todas existan."""
    category_map = get_category_map(category_keys)
    if len(category_map) != len(set(category_keys)):
        raise ValueError("Se detectaron categorías inexistentes o no verificables.")
    return category_map


def _assert_no_latest_duplicate_substituent(
    canonical_smiles: str,
    anchor_indices: list[int],
    excluded_stable_id: uuid.UUID | None = None,
) -> None:
    """Evita duplicados estructurales en entradas activas de catálogo."""
    query = SmileitSubstituent.objects.filter(
        is_latest=True,
        is_active=True,
        smiles_canonical=canonical_smiles,
        anchor_atom_indices=anchor_indices,
    )
    if excluded_stable_id is not None:
        query = query.exclude(stable_id=excluded_stable_id)

    if query.exists():
        raise ValueError("Ya existe un sustituyente estructuralmente equivalente.")


def _validate_substituent_categories_or_raise(
    canonical_smiles: str,
    category_map: dict[str, SmileitCategory],
) -> list[CategoryValidationResult]:
    """Valida reglas de categorías y retorna resultados para persistencia."""
    category_entries: list[SmileitCategory] = [
        category_map[key] for key in sorted(category_map.keys())
    ]
    validations = validate_substituent_categories(canonical_smiles, category_entries)
    failed_validations = [item for item in validations if not item.passed]
    if len(failed_validations) > 0:
        message_lines = [
            f"{entry.category_key}: {entry.message}" for entry in failed_validations
        ]
        raise ValueError(
            "Categorías no válidas para el sustituyente: " + "; ".join(message_lines)
        )

    return validations


# =========================
# Funciones Específicas de Smile-it
# =========================


def _resolve_substituent_owner_user_id(substituent: SmileitSubstituent) -> int | None:
    """Obtiene owner_user_id desde metadata cuando existe y es válido.

    Esta función es específica de SmileitSubstituent. Para funciones genéricas,
    ver `apps.core.permissions._get_owner_user_id_from_metadata()`.
    """
    raw_owner_user_id = substituent.provenance_metadata.get("owner_user_id")
    if raw_owner_user_id is None:
        return None

    try:
        return int(str(raw_owner_user_id).strip())
    except ValueError:
        return None


def _resolve_latest_user_substituent_for_update(
    stable_id: str,
    *,
    actor_user_id: int | None = None,
) -> tuple[uuid.UUID, SmileitSubstituent]:
    """Obtiene el registro vigente editable para realizar una actualización."""
    try:
        stable_uuid = uuid.UUID(stable_id)
    except ValueError as exc:
        raise ValueError(INVALID_STABLE_ID_MESSAGE) from exc

    current_substituent = (
        SmileitSubstituent.objects.filter(
            stable_id=stable_uuid,
            is_latest=True,
            is_active=True,
        )
        .prefetch_related("categories")
        .first()
    )
    if current_substituent is None:
        raise ValueError(MISSING_ACTIVE_SUBSTITUENT_MESSAGE)

    if not _is_substituent_user_editable(current_substituent):
        raise ValueError(
            "Solo se pueden editar catálogos creados por usuario; los seed son inmutables."
        )

    if actor_user_id is not None:
        owner_user_id = _resolve_substituent_owner_user_id(current_substituent)
        if owner_user_id != actor_user_id:
            raise ValueError(
                "No tienes permisos para editar este sustituyente de otro usuario."
            )

    return stable_uuid, current_substituent


def create_catalog_substituent(
    payload: SmileitSubstituentCreatePayload,
    *,
    actor_user_id: int | None = None,
    actor_username: str = "",
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> SmileitCatalogEntry:
    """Crea un nuevo sustituyente persistente si pasa validaciones químicas.

    Args:
        payload: Datos del sustituyente
        actor_user_id: ID del usuario que crea la entrada
        actor_username: Nombre del usuario
        actor_role: Rol del usuario ("root", "admin", "user")
        actor_user_group_ids: Grupos del usuario (para admins)
    """
    canonical_smiles = canonicalize_smiles(payload["smiles"])
    if canonical_smiles is None:
        raise ValueError("El SMILES del sustituyente es inválido.")

    anchor_indices = _assert_anchor_indices(
        canonical_smiles, payload["anchor_atom_indices"]
    )

    category_map = _resolve_category_map_or_raise(payload["category_keys"])
    _assert_no_latest_duplicate_substituent(canonical_smiles, anchor_indices)
    validations = _validate_substituent_categories_or_raise(
        canonical_smiles,
        category_map,
    )

    normalized_metadata = _normalize_metadata(payload["provenance_metadata"])
    if actor_user_id is not None:
        normalized_metadata["owner_user_id"] = str(actor_user_id)
        normalized_metadata["owner_username"] = actor_username.strip()

    # Determinar source_reference basado en actor_role
    if actor_role is not None:
        primary_group_id = None
        if (
            actor_role == "admin"
            and actor_user_group_ids
            and len(actor_user_group_ids) > 0
        ):
            primary_group_id = actor_user_group_ids[0]
            normalized_metadata["owner_group_id"] = str(primary_group_id)
        source_reference = get_source_reference_for_role(actor_role, primary_group_id)
    else:
        source_reference = payload["source_reference"].strip()

    substituent = SmileitSubstituent.objects.create(
        stable_id=uuid.uuid4(),
        version=1,
        is_latest=True,
        is_active=True,
        name=payload["name"].strip(),
        smiles_input=payload["smiles"].strip(),
        smiles_canonical=canonical_smiles,
        anchor_atom_indices=anchor_indices,
        source_reference=source_reference,
        provenance_metadata=normalized_metadata,
        created_by_id=actor_user_id,
    )

    for validation in validations:
        category = category_map[validation.category_key]
        SmileitSubstituentCategory.objects.create(
            substituent=substituent,
            category=category,
            verification_passed=validation.passed,
            verification_message=validation.message,
        )

    return _serialize_substituent(substituent)


def update_catalog_substituent(
    stable_id: str,
    payload: SmileitSubstituentCreatePayload,
    *,
    actor_user_id: int | None = None,
    actor_username: str = "",
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> SmileitCatalogEntry:
    """Crea una nueva versión editable de un sustituyente de usuario.

    Args:
        stable_id: ID único del sustituyente
        payload: Nuevos datos
        actor_user_id: ID del usuario que edita
        actor_username: Nombre del usuario
        actor_role: Rol del usuario ("root", "admin", "user")
        actor_user_group_ids: Grupos del usuario
    """
    if actor_user_group_ids is None:
        actor_user_group_ids = []

    # Compatibilidad legacy: clientes anónimos siguen usando la validación clásica
    # para edición de entradas no-seed. Si hay actor autenticado, aplica permisos multinivel.
    if actor_user_id is None and actor_role is None:
        stable_uuid, current_substituent = _resolve_latest_user_substituent_for_update(
            stable_id,
            actor_user_id=None,
        )
    else:
        try:
            stable_uuid = uuid.UUID(stable_id)
        except ValueError as exc:
            raise ValueError(INVALID_STABLE_ID_MESSAGE) from exc

        current_substituent = (
            SmileitSubstituent.objects.filter(
                stable_id=stable_uuid,
                is_latest=True,
                is_active=True,
            )
            .prefetch_related("categories")
            .first()
        )
        if current_substituent is None:
            raise ValueError(MISSING_ACTIVE_SUBSTITUENT_MESSAGE)

        if not can_user_edit_entry(
            entry=current_substituent,
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            actor_user_groups=actor_user_group_ids,
        ):
            raise PermissionError("No tienes permisos para editar este sustituyente.")

    canonical_smiles = canonicalize_smiles(payload["smiles"])
    if canonical_smiles is None:
        raise ValueError("El SMILES del sustituyente es inválido.")

    anchor_indices = _assert_anchor_indices(
        canonical_smiles, payload["anchor_atom_indices"]
    )

    category_map = _resolve_category_map_or_raise(payload["category_keys"])
    _assert_no_latest_duplicate_substituent(
        canonical_smiles,
        anchor_indices,
        excluded_stable_id=stable_uuid,
    )
    validations = _validate_substituent_categories_or_raise(
        canonical_smiles,
        category_map,
    )

    normalized_metadata = _normalize_metadata(payload["provenance_metadata"])
    if len(normalized_metadata) == 0:
        normalized_metadata = {
            str(meta_key): str(meta_value)
            for meta_key, meta_value in current_substituent.provenance_metadata.items()
        }

    if actor_user_id is not None:
        normalized_metadata["owner_user_id"] = str(actor_user_id)
        normalized_metadata["owner_username"] = actor_username.strip()

    # Preservar source_reference (no cambiar el ownership en ediciones)
    source_reference = current_substituent.source_reference

    with transaction.atomic():
        SmileitSubstituent.objects.filter(pk=current_substituent.pk).update(
            is_latest=False
        )

        updated_substituent = SmileitSubstituent.objects.create(
            stable_id=stable_uuid,
            version=current_substituent.version + 1,
            is_latest=True,
            is_active=True,
            name=payload["name"].strip(),
            smiles_input=payload["smiles"].strip(),
            smiles_canonical=canonical_smiles,
            anchor_atom_indices=anchor_indices,
            source_reference=source_reference,
            provenance_metadata=normalized_metadata,
            created_by_id=actor_user_id,
        )

        for validation in validations:
            category = category_map[validation.category_key]
            SmileitSubstituentCategory.objects.create(
                substituent=updated_substituent,
                category=category,
                verification_passed=validation.passed,
                verification_message=validation.message,
            )

    return _serialize_substituent(updated_substituent)


def create_pattern_entry(
    payload: SmileitPatternCreatePayload,
    *,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> SmileitPatternEntry:
    """Crea patrón estructural nuevo con validación de SMARTS y caption.

    Args:
        payload: Datos del patrón
        actor_user_id: ID del usuario que crea
        actor_role: Rol del usuario ("root", "admin", "user")
        actor_user_group_ids: Grupos del usuario
    """
    if payload["caption"].strip() == "":
        raise ValueError("El patrón requiere un caption/description obligatorio.")

    if not validate_smarts(payload["smarts"]):
        raise ValueError("El SMARTS indicado es inválido.")

    duplicates = SmileitPattern.objects.filter(
        is_latest=True,
        is_active=True,
        smarts=payload["smarts"].strip(),
        pattern_type=payload["pattern_type"],
    ).exists()
    if duplicates:
        raise ValueError("Ya existe un patrón activo con el mismo SMARTS y tipo.")

    normalized_metadata = _normalize_metadata(payload["provenance_metadata"])
    if actor_user_id is not None:
        normalized_metadata["owner_user_id"] = str(actor_user_id)

    # Determinar source_reference basado en actor_role
    if actor_role is not None:
        primary_group_id = None
        if (
            actor_role == "admin"
            and actor_user_group_ids
            and len(actor_user_group_ids) > 0
        ):
            primary_group_id = actor_user_group_ids[0]
            normalized_metadata["owner_group_id"] = str(primary_group_id)
        source_reference = get_source_reference_for_role(actor_role, primary_group_id)
    else:
        source_reference = payload["source_reference"].strip()

    pattern = SmileitPattern.objects.create(
        stable_id=uuid.uuid4(),
        version=1,
        is_latest=True,
        is_active=True,
        name=payload["name"].strip(),
        smarts=payload["smarts"].strip(),
        pattern_type=payload["pattern_type"],
        caption=payload["caption"].strip(),
        source_reference=source_reference,
        provenance_metadata=normalized_metadata,
        created_by_id=actor_user_id,
    )
    return _serialize_pattern(pattern)


def resolve_catalog_substituent_reference(
    reference: SmileitSubstituentReferenceInput,
) -> SmileitCatalogEntry:
    """Resuelve una referencia inmutable de sustituyente por stable_id + version."""
    entry = (
        SmileitSubstituent.objects.filter(
            stable_id=reference["stable_id"],
            version=reference["version"],
            is_active=True,
        )
        .prefetch_related("categories")
        .first()
    )
    if entry is None:
        raise ValueError(
            "No existe un sustituyente activo para la referencia "
            f"{reference['stable_id']}@{reference['version']}."
        )
    return _serialize_substituent(entry)


def resolve_catalog_substituents_by_categories(
    category_keys: list[str],
) -> list[SmileitCatalogEntry]:
    """Obtiene sustituyentes activos que pertenezcan a cualquiera de las categorías."""
    normalized_keys = sorted(
        {item.strip() for item in category_keys if item.strip() != ""}
    )
    if len(normalized_keys) == 0:
        return []

    entries = (
        SmileitSubstituent.objects.filter(
            is_latest=True,
            is_active=True,
            categories__key__in=normalized_keys,
            categories__is_latest=True,
            categories__is_active=True,
        )
        .prefetch_related("categories")
        .distinct()
        .order_by("name", "stable_id")
    )
    return [_serialize_substituent(entry) for entry in entries]


def normalize_manual_substituent(
    entry: SmileitManualSubstituentInput,
) -> SmileitCatalogEntry:
    """Normaliza sustituyente manual para reutilizar flujo común de resolución."""
    canonical_smiles = canonicalize_smiles(entry["smiles"])
    if canonical_smiles is None:
        raise ValueError(
            f"El sustituyente manual '{entry['name']}' tiene SMILES inválido."
        )

    anchor_indices = _assert_anchor_indices(
        canonical_smiles, entry["anchor_atom_indices"]
    )
    category_map = get_category_map(entry["categories"])
    if len(category_map) != len(set(entry["categories"])):
        raise ValueError(
            f"El sustituyente manual '{entry['name']}' incluye categorías no verificables."
        )

    validations = validate_substituent_categories(
        canonical_smiles,
        [category_map[key] for key in sorted(category_map.keys())],
    )
    failed_validations = [item for item in validations if not item.passed]
    if len(failed_validations) > 0:
        message_lines = [
            f"{item.category_key}: {item.message}" for item in failed_validations
        ]
        raise ValueError(
            f"El sustituyente manual '{entry['name']}' no cumple categorías: "
            + "; ".join(message_lines)
        )

    source_reference = entry.get("source_reference", "manual")
    provenance_metadata = entry.get("provenance_metadata", {})
    return SmileitCatalogEntry(
        id="",
        stable_id=f"manual::{uuid.uuid4()}",
        version=1,
        name=entry["name"].strip(),
        smiles=canonical_smiles,
        anchor_atom_indices=anchor_indices,
        categories=sorted(category_map.keys()),
        source_reference=source_reference.strip(),
        provenance_metadata=_normalize_metadata(provenance_metadata),
    )


def update_pattern_entry(
    stable_id: str,
    payload: SmileitPatternCreatePayload,
    *,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> SmileitPatternEntry:
    """Crea una nueva versión de un patrón estructural existente (versionado).

    Los patrones son editables solo si no son semilla (seed=False en metadata).

    Args:
        stable_id: ID del patrón
        payload: Nuevos datos
        actor_user_id: ID del usuario que edita
        actor_role: Rol del usuario
        actor_user_group_ids: Grupos del usuario
    """
    if actor_user_group_ids is None:
        actor_user_group_ids = []

    # Resolver UUID del stable_id
    try:
        stable_uuid = uuid.UUID(stable_id)
    except ValueError as exc:
        raise ValueError(INVALID_STABLE_ID_MESSAGE) from exc

    # Obtener la versión vigente
    current_pattern = SmileitPattern.objects.filter(
        stable_id=stable_uuid,
        is_latest=True,
        is_active=True,
    ).first()

    if current_pattern is None:
        raise ValueError("No existe un patrón activo para el stable_id indicado.")

    # Validar permisos con la nueva función
    if not can_user_edit_entry(
        entry=current_pattern,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_user_group_ids,
    ):
        raise PermissionError("No tienes permisos para editar este patrón.")

    # Validar SMARTS
    if not validate_smarts(payload["smarts"]):
        raise ValueError("El SMARTS indicado es inválido.")

    # Verificar duplicados (excluyendo el patrón actual)
    duplicates = (
        SmileitPattern.objects.filter(
            is_latest=True,
            is_active=True,
            smarts=payload["smarts"].strip(),
            pattern_type=payload["pattern_type"],
        )
        .exclude(stable_id=stable_uuid)
        .exists()
    )
    if duplicates:
        raise ValueError("Ya existe un patrón activo con el mismo SMARTS y tipo.")

    # Normalizar metadata
    normalized_metadata = _normalize_metadata(payload["provenance_metadata"])
    if len(normalized_metadata) == 0:
        normalized_metadata = dict(current_pattern.provenance_metadata)

    if actor_user_id is not None:
        normalized_metadata["owner_user_id"] = str(actor_user_id)

    # Preservar source_reference
    source_reference = current_pattern.source_reference

    with transaction.atomic():
        SmileitPattern.objects.filter(pk=current_pattern.pk).update(is_latest=False)

        new_pattern = SmileitPattern.objects.create(
            stable_id=stable_uuid,
            version=current_pattern.version + 1,
            is_latest=True,
            is_active=True,
            name=payload["name"].strip(),
            smarts=payload["smarts"].strip(),
            pattern_type=payload["pattern_type"],
            caption=payload["caption"].strip(),
            source_reference=source_reference,
            provenance_metadata=normalized_metadata,
            created_by_id=actor_user_id,
        )

    return _serialize_pattern(new_pattern)


def delete_pattern_entry(
    stable_id: str,
    *,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> None:
    """Desactiva lógicamente un patrón estructural (soft-delete para trazabilidad).

    Los patrones que el usuario tiene permisos para editar pueden eliminarse.

    Args:
        stable_id: ID del patrón
        actor_user_id: ID del usuario
        actor_role: Rol del usuario
        actor_user_group_ids: Grupos del usuario
    """
    if actor_user_group_ids is None:
        actor_user_group_ids = []

    try:
        stable_uuid = uuid.UUID(stable_id)
    except ValueError as exc:
        raise ValueError(INVALID_STABLE_ID_MESSAGE) from exc

    pattern = SmileitPattern.objects.filter(
        stable_id=stable_uuid,
        is_latest=True,
        is_active=True,
    ).first()

    if pattern is None:
        raise ValueError("No existe un patrón activo para el stable_id indicado.")

    # Validar permisos con la nueva función
    if not can_user_delete_entry(
        entry=pattern,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_user_group_ids,
    ):
        raise PermissionError("No tienes permisos para eliminar este patrón.")

    # Soft-delete: solo desactivar
    pattern.is_active = False
    pattern.save(update_fields=["is_active", "updated_at"])


def delete_catalog_substituent(
    stable_id: str,
    *,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    actor_user_group_ids: list[int] | None = None,
) -> None:
    """Desactiva lógicamente un sustituyente de catálogo (soft-delete para trazabilidad).

    Solo los sustituyentes que el usuario tiene permisos para editar pueden eliminarse.
    """
    if actor_user_group_ids is None:
        actor_user_group_ids = []

    try:
        stable_uuid = uuid.UUID(stable_id)
    except ValueError as exc:
        raise ValueError(INVALID_STABLE_ID_MESSAGE) from exc

    substituent = (
        SmileitSubstituent.objects.filter(
            stable_id=stable_uuid,
            is_latest=True,
            is_active=True,
        )
        .prefetch_related("categories")
        .first()
    )

    if substituent is None:
        raise ValueError(MISSING_ACTIVE_SUBSTITUENT_MESSAGE)

    # Validar permisos con la nueva función
    if not can_user_delete_entry(
        entry=substituent,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_user_group_ids,
    ):
        raise PermissionError("No tienes permisos para eliminar este sustituyente.")

    # Soft-delete: solo desactivar
    substituent.is_active = False
    substituent.save(update_fields=["is_active", "updated_at"])

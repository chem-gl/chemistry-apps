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


def list_active_catalog_entries() -> list[SmileitCatalogEntry]:
    """Lista sustituyentes activos y vigentes para selección en UI/API."""
    entries = (
        SmileitSubstituent.objects.filter(is_latest=True, is_active=True)
        .prefetch_related("categories")
        .order_by("name", "stable_id")
    )
    return [_serialize_substituent(entry) for entry in entries]


def list_active_patterns() -> list[SmileitPatternEntry]:
    """Lista patrones estructurales activos para anotación visual."""
    patterns = SmileitPattern.objects.filter(is_latest=True, is_active=True).order_by(
        "pattern_type", "name"
    )
    return [_serialize_pattern(entry) for entry in patterns]


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


def _resolve_latest_user_substituent_for_update(
    stable_id: str,
) -> tuple[uuid.UUID, SmileitSubstituent]:
    """Obtiene el registro vigente editable para realizar una actualización."""
    try:
        stable_uuid = uuid.UUID(stable_id)
    except ValueError as exc:
        raise ValueError("El stable_id indicado no tiene formato UUID válido.") from exc

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
        raise ValueError("No existe un sustituyente activo para el stable_id indicado.")

    if not _is_substituent_user_editable(current_substituent):
        raise ValueError(
            "Solo se pueden editar catálogos creados por usuario; los seed son inmutables."
        )

    return stable_uuid, current_substituent


def create_catalog_substituent(
    payload: SmileitSubstituentCreatePayload,
) -> SmileitCatalogEntry:
    """Crea un nuevo sustituyente persistente si pasa validaciones químicas."""
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

    substituent = SmileitSubstituent.objects.create(
        stable_id=uuid.uuid4(),
        version=1,
        is_latest=True,
        is_active=True,
        name=payload["name"].strip(),
        smiles_input=payload["smiles"].strip(),
        smiles_canonical=canonical_smiles,
        anchor_atom_indices=anchor_indices,
        source_reference=payload["source_reference"].strip(),
        provenance_metadata=_normalize_metadata(payload["provenance_metadata"]),
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
) -> SmileitCatalogEntry:
    """Crea una nueva versión editable de un sustituyente de usuario."""
    stable_uuid, current_substituent = _resolve_latest_user_substituent_for_update(
        stable_id
    )

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

    source_reference = payload["source_reference"].strip()
    if source_reference == "":
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


def create_pattern_entry(payload: SmileitPatternCreatePayload) -> SmileitPatternEntry:
    """Crea patrón estructural nuevo con validación de SMARTS y caption."""
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

    pattern = SmileitPattern.objects.create(
        stable_id=uuid.uuid4(),
        version=1,
        is_latest=True,
        is_active=True,
        name=payload["name"].strip(),
        smarts=payload["smarts"].strip(),
        pattern_type=payload["pattern_type"],
        caption=payload["caption"].strip(),
        source_reference=payload["source_reference"].strip(),
        provenance_metadata=_normalize_metadata(payload["provenance_metadata"]),
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

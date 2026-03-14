"""plugin.py: Plugin científico de generación de sustituyentes SMILES (smileit).

Objetivo del archivo:
- Implementar la lógica de generación combinatoria de moléculas mediante
  sustitución en átomos seleccionados, usando RDKit como motor de química.
- Registrar la función en PluginRegistry para que el core la despache.

Cómo se usa:
- El DeclarativeJobAPI del core importa y ejecuta `smileit_plugin` cuando
  un job de tipo 'smileit' pasa al estado RUNNING.
- Recibe un dict serializable con los parámetros del job y retorna un JSONMap.

Algoritmo (paridad funcional con GeneratorPermutesSmile.java del legado):
1. Parsear y canonicalizar la molécula principal.
2. Expandir sustituyentes: por cada sustituyente con N átomos seleccionados,
   crear N variantes con un único átomo de anclaje cada una.
3. Inicializar generate = {principal_smiles canónico}.
4. Por cada ronda r en range(r_substitutes):
   - Para cada molécula en generate (snapshot de la ronda anterior):
     - Para cada sustituyente expandido:
       - Para cada bond_order en range(1, num_bonds+1):
         - Intentar fusión en todos los átomos seleccionados del principal
           vs el átomo de anclaje del sustituyente.
         - Si fusión valid, agregar SMILES resultado a generate.
5. Si allow_repeated=False, deduplicar por SMILES canónico.
6. Truncar a max_structures si se supera el límite.
7. Renderizar SVG para cada estructura generada.
"""

import logging
from typing import Optional

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    MAX_GENERATED_STRUCTURES,
    MAX_NUM_BONDS,
    MAX_R_SUBSTITUTES,
    PLUGIN_NAME,
)
from .engine import canonicalize_smiles, fuse_molecules, render_molecule_svg
from .types import (
    SmileitGeneratedStructure,
    SmileitInput,
    SmileitJobCreatePayload,
    SmileitResult,
    SmileitSubstituentInput,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------


def _expand_substituents(
    substituents: list[SmileitSubstituentInput],
) -> list[SmileitSubstituentInput]:
    """Expande sustituyentes: si uno tuviera múltiples átomos seleccionados,
    generaría N variantes. En el modelo actual del API cada entrada ya tiene
    un solo selected_atom_index, por lo que la expansión es 1-a-1.

    Mantiene la misma semántica que `generateSubstitutes()` del legado Java.
    """
    expanded: list[SmileitSubstituentInput] = []
    for sub in substituents:
        canonical = canonicalize_smiles(sub["smiles"])
        if canonical is None:
            logger.warning(
                "Sustituyente con SMILES inválido omitido: %r", sub["smiles"]
            )
            continue
        expanded.append(
            SmileitSubstituentInput(
                name=sub["name"],
                smiles=canonical,
                selected_atom_index=sub["selected_atom_index"],
            )
        )
    return expanded


def _generate_permutes_round(
    current_molecules: list[tuple[str, str]],  # (smiles, name)
    substituents: list[SmileitSubstituentInput],
    selected_atom_indices: list[int],
    num_bonds: int,
    seen_smiles: set[str],
    allow_repeated: bool,
    current_total_count: int,
    max_structures: int,
) -> list[tuple[str, str]]:
    """Ejecuta una ronda de permutación: combina cada molécula actual con cada sustituyente.

    Retorna la lista de moléculas nuevas añadidas en esta ronda.
    """
    new_molecules: list[tuple[str, str]] = []

    for principal_smiles, principal_name in current_molecules:
        if _reached_generation_limit(
            current_total_count, new_molecules, max_structures
        ):
            break
        _extend_round_with_principal(
            principal_smiles=principal_smiles,
            principal_name=principal_name,
            substituents=substituents,
            selected_atom_indices=selected_atom_indices,
            num_bonds=num_bonds,
            seen_smiles=seen_smiles,
            allow_repeated=allow_repeated,
            current_total_count=current_total_count,
            max_structures=max_structures,
            new_molecules=new_molecules,
        )

    return new_molecules


def _extend_round_with_principal(
    principal_smiles: str,
    principal_name: str,
    substituents: list[SmileitSubstituentInput],
    selected_atom_indices: list[int],
    num_bonds: int,
    seen_smiles: set[str],
    allow_repeated: bool,
    current_total_count: int,
    max_structures: int,
    new_molecules: list[tuple[str, str]],
) -> None:
    """Genera candidatas desde una molécula principal para reducir complejidad ciclomática."""
    from rdkit import Chem as _Chem

    principal_molecule = _Chem.MolFromSmiles(principal_smiles)
    if principal_molecule is None:
        return

    principal_atom_indices = _resolve_principal_atom_indices(
        principal_molecule,
        selected_atom_indices,
    )

    for substituent in substituents:
        if _reached_generation_limit(
            current_total_count, new_molecules, max_structures
        ):
            break

        substituent_atom_idx = _resolve_substituent_anchor(
            substituent["smiles"], substituent["selected_atom_index"]
        )
        _append_substituent_variants(
            principal_smiles=principal_smiles,
            principal_name=principal_name,
            substituent=substituent,
            substituent_atom_idx=substituent_atom_idx,
            principal_atom_indices=principal_atom_indices,
            num_bonds=num_bonds,
            seen_smiles=seen_smiles,
            allow_repeated=allow_repeated,
            current_total_count=current_total_count,
            max_structures=max_structures,
            new_molecules=new_molecules,
        )


def _append_substituent_variants(
    principal_smiles: str,
    principal_name: str,
    substituent: SmileitSubstituentInput,
    substituent_atom_idx: Optional[int],
    principal_atom_indices: list[Optional[int]],
    num_bonds: int,
    seen_smiles: set[str],
    allow_repeated: bool,
    current_total_count: int,
    max_structures: int,
    new_molecules: list[tuple[str, str]],
) -> None:
    """Genera variantes para un sustituyente concreto sobre todos los átomos objetivo."""
    for bond_order in range(1, num_bonds + 1):
        if _reached_generation_limit(
            current_total_count, new_molecules, max_structures
        ):
            break

        for principal_atom_idx in principal_atom_indices:
            if _reached_generation_limit(
                current_total_count, new_molecules, max_structures
            ):
                break

            fused_smiles = fuse_molecules(
                principal_smiles=principal_smiles,
                substituent_smiles=substituent["smiles"],
                principal_atom_idx=principal_atom_idx,
                substituent_atom_idx=substituent_atom_idx,
                bond_order=bond_order,
            )
            if fused_smiles is None:
                continue

            if not allow_repeated:
                if fused_smiles in seen_smiles:
                    continue
                seen_smiles.add(fused_smiles)

            fused_name = f"{principal_name}<{principal_atom_idx}> |{bond_order}| {substituent['name']}"
            new_molecules.append((fused_smiles, fused_name))


def _resolve_principal_atom_indices(
    principal_molecule: object,
    selected_atom_indices: list[int],
) -> list[Optional[int]]:
    """Resuelve índices del principal preservando la semántica monoatómica del legado."""
    from rdkit import Chem as _Chem

    molecule = principal_molecule if isinstance(principal_molecule, _Chem.Mol) else None
    if molecule is None:
        return []
    if molecule.GetNumAtoms() == 1:
        return [None]
    return list(selected_atom_indices)


def _resolve_substituent_anchor(
    substituent_smiles: str,
    selected_atom_index: int,
) -> Optional[int]:
    """Usa `None` para sustituyentes monoatómicos y el índice configurado en los demás."""
    from rdkit import Chem as _Chem

    substituent_molecule = _Chem.MolFromSmiles(substituent_smiles)
    if substituent_molecule is None:
        return selected_atom_index
    if substituent_molecule.GetNumAtoms() == 1:
        return None
    return selected_atom_index


def _reached_generation_limit(
    current_total_count: int,
    new_molecules: list[tuple[str, str]],
    max_structures: int,
) -> bool:
    """Centraliza el control del límite máximo de estructuras."""
    return current_total_count + len(new_molecules) >= max_structures


def _build_smileit_input(payload: SmileitJobCreatePayload) -> SmileitInput:
    """Construye SmileitInput validado desde el payload del job."""
    return SmileitInput(
        principal_smiles=payload["principal_smiles"],
        selected_atom_indices=payload["selected_atom_indices"],
        substituents=payload["substituents"],
        options={
            "r_substitutes": payload["r_substitutes"],
            "num_bonds": payload["num_bonds"],
            "allow_repeated": payload["allow_repeated"],
            "max_structures": payload["max_structures"],
        },
        version=payload["version"],
    )


# ---------------------------------------------------------------------------
# Plugin principal
# ---------------------------------------------------------------------------


@PluginRegistry.register(PLUGIN_NAME)
def smileit_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Plugin de generación combinatoria de sustituyentes SMILES.

    Recibe los parámetros del job y ejecuta el algoritmo de permutación.
    Retorna un JSONMap serializable compatible con el core de jobs.

    Args:
        parameters: Dict con campos de SmileitInput serializados.
        progress_callback: Callback del core para reportar progreso.
        log_callback: Callback opcional para emitir logs de ejecución.

    Returns:
        JSONMap con los campos de SmileitResult.
    """
    payload: SmileitJobCreatePayload = parameters  # type: ignore[assignment]

    principal_smiles_raw: str = payload["principal_smiles"]
    selected_atom_indices: list[int] = payload["selected_atom_indices"]
    substituents_raw: list[SmileitSubstituentInput] = payload["substituents"]  # type: ignore[assignment]
    r_substitutes: int = min(int(payload["r_substitutes"]), MAX_R_SUBSTITUTES)
    num_bonds: int = min(int(payload["num_bonds"]), MAX_NUM_BONDS)
    allow_repeated: bool = bool(payload["allow_repeated"])
    max_structures: int = min(int(payload["max_structures"]), MAX_GENERATED_STRUCTURES)

    progress_callback(5, "running", "Validando parámetros del job smileit.")

    # Canonicalizar molécula principal
    canonical_principal = canonicalize_smiles(principal_smiles_raw)
    if canonical_principal is None:
        raise ValueError(f"SMILES principal inválido: {principal_smiles_raw!r}")

    # Expandir y validar sustituyentes
    substituents = _expand_substituents(substituents_raw)
    if not substituents:
        raise ValueError("No hay sustituyentes válidos para la generación.")

    progress_callback(
        15, "running", "Sustituyentes validados. Iniciando generación combinatoria."
    )

    logger.info(
        "Iniciando generación smileit: principal=%r, átomos=%s, sustituyentes=%d, rondas=%d",
        canonical_principal,
        selected_atom_indices,
        len(substituents),
        r_substitutes,
    )

    # Estado inicial: solo la molécula principal
    principal_name: str = payload.get("principal_name", "principal")  # type: ignore[attr-defined]
    seen_smiles: set[str] = {canonical_principal}
    all_molecules: list[tuple[str, str]] = [(canonical_principal, str(principal_name))]

    # Rondas de permutación
    truncated: bool = False
    for round_idx in range(r_substitutes):
        if len(all_molecules) >= max_structures:
            truncated = True
            logger.info(
                "Límite max_structures=%d alcanzado en ronda %d",
                max_structures,
                round_idx,
            )
            break

        # Snapshot de la ronda anterior (mismo comportamiento que el legado)
        snapshot = list(all_molecules)
        new_in_round = _generate_permutes_round(
            current_molecules=snapshot,
            substituents=substituents,
            selected_atom_indices=selected_atom_indices,
            num_bonds=num_bonds,
            seen_smiles=seen_smiles,
            allow_repeated=allow_repeated,
            current_total_count=len(all_molecules),
            max_structures=max_structures,
        )

        all_molecules.extend(new_in_round)

        if len(all_molecules) >= max_structures:
            truncated = True

        logger.info(
            "Ronda %d: +%d estructuras (total=%d)",
            round_idx + 1,
            len(new_in_round),
            len(all_molecules),
        )

        # Progreso proporcional entre 15% y 75% durante las rondas
        round_progress: int = 15 + int(60 * (round_idx + 1) / max(r_substitutes, 1))
        progress_callback(
            round_progress,
            "running",
            f"Ronda {round_idx + 1}/{r_substitutes}: {len(all_molecules)} estructuras generadas.",
        )

    progress_callback(80, "running", "Renderizando SVGs para cada estructura.")

    # Construir resultado con SVGs
    generated_structures: list[SmileitGeneratedStructure] = []
    for smiles_val, name_val in all_molecules:
        svg: str = render_molecule_svg(smiles_val)
        generated_structures.append(
            SmileitGeneratedStructure(smiles=smiles_val, name=name_val, svg=svg)
        )

    result: SmileitResult = SmileitResult(
        total_generated=len(generated_structures),
        generated_structures=generated_structures,
        truncated=truncated,
        principal_smiles=canonical_principal,
        selected_atom_indices=selected_atom_indices,
    )

    logger.info(
        "smileit_plugin completado: %d estructuras generadas, truncado=%s",
        result["total_generated"],
        result["truncated"],
    )

    progress_callback(
        100,
        "completed",
        f"Generación smileit finalizada: {result['total_generated']} estructuras.",
    )

    return dict(result)  # type: ignore[return-value]

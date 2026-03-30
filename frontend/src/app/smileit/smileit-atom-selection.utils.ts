// smileit-atom-selection.utils.ts: Utilidades puras para parseo y normalización de selección atómica en Smileit.

import { SmileitStructureInspectionView } from '../core/api/jobs-api.service';

export function normalizeAnchorIndices(anchorIndices: number[]): number[] {
  return Array.from(new Set(anchorIndices)).sort((left: number, right: number) => left - right);
}

export function parseAtomIndicesInput(rawText: string): number[] {
  const parsedValues: number[] = rawText
    .split(',')
    .map((part: string) => part.trim())
    .filter((part: string) => part !== '')
    .map((part: string) => Number(part))
    .filter((value: number) => Number.isInteger(value) && value >= 0);

  return normalizeAnchorIndices(parsedValues);
}

export function formatAtomIndices(anchorIndices: number[]): string {
  return anchorIndices.join(',');
}

export function hasSameNumberSet(firstValues: number[], secondValues: number[]): boolean {
  if (firstValues.length !== secondValues.length) {
    return false;
  }

  return firstValues.every((value: number, index: number) => value === secondValues[index]);
}

export function resolveDefaultAnchorIndices(
  inspectionResult: SmileitStructureInspectionView,
): number[] {
  const preferredAtomIndices: number[] = inspectionResult.atoms
    .filter((atom) => atom.symbol.trim().toUpperCase() !== 'H')
    .map((atom) => atom.index);

  if (preferredAtomIndices.length > 0) {
    return normalizeAnchorIndices(preferredAtomIndices);
  }

  return normalizeAnchorIndices(inspectionResult.atoms.map((atom) => atom.index));
}

export function resolveValidAnchorSelection(
  currentAnchorIndices: number[],
  inspectionResult: SmileitStructureInspectionView,
): number[] {
  const validAnchorIndices: number[] = normalizeAnchorIndices(
    currentAnchorIndices.filter(
      (atomIndex: number) => atomIndex >= 0 && atomIndex < inspectionResult.atomCount,
    ),
  );

  if (validAnchorIndices.length > 0) {
    return validAnchorIndices;
  }

  return resolveDefaultAnchorIndices(inspectionResult);
}

export function resolveSingleValidAnchorSelection(
  currentAnchorIndices: number[],
  inspectionResult: SmileitStructureInspectionView,
): number[] {
  return resolveValidAnchorSelection(currentAnchorIndices, inspectionResult).slice(0, 1);
}

export function toggleAtomSelection(currentSelection: number[], atomIndex: number): number[] {
  const isAlreadySelected: boolean = currentSelection.includes(atomIndex);
  if (isAlreadySelected) {
    return normalizeAnchorIndices(
      currentSelection.filter((selectedAtomIndex: number) => selectedAtomIndex !== atomIndex),
    );
  }

  return normalizeAnchorIndices([...currentSelection, atomIndex]);
}

// smileit-workflow.utils.ts: Funciones puras reutilizables por los sub-servicios del workflow Smileit.
// Contiene lógica de deduplicación, parsing de índices, detección de notación y agrupación de catálogo.

import type { SmileitCatalogEntryView, SmileitCategoryView } from '../../api/jobs-api.service';

import type {
  SmileitAssignmentBlockDraft,
  SmileitCatalogGroupView,
  SmileitChemicalNotationKind,
  SmileitSiteCoverageView,
} from './smileit-workflow.types';

// ---------------------------------------------------------------------------
// Deduplicación genérica por stable_id + version
// ---------------------------------------------------------------------------

/** Elimina duplicados de entradas versionadas conservando la primera aparición. */
export function dedupeVersionedEntries<T extends { stable_id: string; version: number }>(
  entries: T[],
): T[] {
  const dedupedEntries: T[] = [];
  const seenKeys: Set<string> = new Set();

  entries.forEach((entry: T) => {
    const entryKey: string = `${entry.stable_id}:${entry.version}`;
    if (seenKeys.has(entryKey)) {
      return;
    }
    seenKeys.add(entryKey);
    dedupedEntries.push(entry);
  });

  return dedupedEntries;
}

// ---------------------------------------------------------------------------
// Extracción de mensajes de error de peticiones HTTP
// ---------------------------------------------------------------------------

/** Extrae mensaje de error si el valor es una cadena no vacía, null en caso contrario. */
function extractFromStringError(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  return null;
}

/** Extrae mensaje de error uniendo las cadenas no vacías de un array, null si no aplica. */
function extractFromArrayError(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const joined: string = value
    .filter((entry: unknown) => typeof entry === 'string' && entry.trim() !== '')
    .join(' ');
  return joined === '' ? null : joined;
}

/** Extrae mensajes de error desde los valores string/array de un objeto, null si no aplica. */
function extractFromObjectError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const entries: string[] = Object.values(value as Record<string, unknown>).flatMap(
    (entry: unknown) => {
      const fromString = extractFromStringError(entry);
      if (fromString !== null) {
        return [fromString];
      }
      if (Array.isArray(entry)) {
        return entry.filter(
          (message: unknown) => typeof message === 'string' && message.trim() !== '',
        ) as string[];
      }
      return [];
    },
  );
  return entries.length > 0 ? entries.join(' ') : null;
}

/** Extrae un mensaje legible de un error de petición HTTP (HttpErrorResponse u otros). */
export function extractRequestErrorMessage(requestError: unknown): string {
  if (requestError instanceof Error && requestError.message.trim() !== '') {
    return requestError.message;
  }

  if (typeof requestError !== 'object' || requestError === null) {
    return 'Unexpected request failure.';
  }

  const errorContainer: Record<string, unknown> = requestError as Record<string, unknown>;
  const nestedError: unknown = errorContainer['error'];

  return (
    extractFromStringError(nestedError) ??
    extractFromArrayError(nestedError) ??
    extractFromObjectError(nestedError) ??
    'Unexpected request failure.'
  );
}

// ---------------------------------------------------------------------------
// Parsing de índices de átomos
// ---------------------------------------------------------------------------

/** Parsea una cadena separada por comas a un arreglo único de índices numéricos ≥ 0. */
export function parseAtomIndicesInput(rawValue: string): number[] {
  return rawValue
    .split(',')
    .filter((token: string) => token.trim() !== '')
    .map((token: string) => Number(token.trim()))
    .filter((token: number) => Number.isInteger(token) && token >= 0)
    .filter((token: number, index: number, items: number[]) => items.indexOf(token) === index)
    .sort((left: number, right: number) => left - right);
}

/** Variante que retorna como máximo un solo índice anchor. */
export function parseSingleAnchorIndexInput(rawText: string): number[] {
  return parseAtomIndicesInput(rawText).slice(0, 1);
}

// ---------------------------------------------------------------------------
// Utilidades de cadenas
// ---------------------------------------------------------------------------

/** Escapa caracteres especiales de regex en un texto plano. */
export function escapeRegExp(rawText: string): string {
  return rawText.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Alterna la presencia de un valor en un arreglo de strings, manteniendo orden alfabético. */
export function toggleString(currentValues: string[], nextValue: string): string[] {
  return currentValues.includes(nextValue)
    ? currentValues.filter((item: string) => item !== nextValue)
    : [...currentValues, nextValue].sort((left: string, right: string) =>
        left.localeCompare(right),
      );
}

// ---------------------------------------------------------------------------
// Detección heurística de notación química
// ---------------------------------------------------------------------------

/** Detecta si el texto parece SMILES, SMARTS o está vacío. */
export function detectChemicalNotation(rawChemicalText: string): SmileitChemicalNotationKind {
  const normalizedText: string = rawChemicalText.trim();
  if (normalizedText === '') {
    return 'empty';
  }

  // Heurística simple para advertir entrada SMARTS en formularios que exigen SMILES.
  const smartsMarkers: RegExp = /\*|;|\$\(|!|\[\$|\?\]|\(\?\)/;
  return smartsMarkers.test(normalizedText) ? 'smarts' : 'smiles';
}

// ---------------------------------------------------------------------------
// Agrupación de entradas de catálogo por categoría
// ---------------------------------------------------------------------------

/** Agrupa entradas de catálogo por sus categorías, generando una lista ordenada. */
export function buildCatalogGroups(
  catalogEntries: SmileitCatalogEntryView[],
  categories: SmileitCategoryView[],
): SmileitCatalogGroupView[] {
  const categoryNameByKey: Map<string, string> = new Map(
    categories.map((category: SmileitCategoryView) => [category.key, category.name]),
  );
  const groupedEntries: Map<string, SmileitCatalogGroupView> = new Map();

  catalogEntries.forEach((entry: SmileitCatalogEntryView) => {
    const entryCategoryKeys: string[] = entry.categories ?? [];
    const entryCategories: string[] =
      entryCategoryKeys.length > 0 ? entryCategoryKeys : ['uncategorized'];

    entryCategories.forEach((categoryKey: string) => {
      const groupKey: string = categoryKey;
      const groupName: string =
        categoryKey === 'uncategorized'
          ? 'Uncategorized'
          : (categoryNameByKey.get(categoryKey) ?? categoryKey);

      const existingGroup: SmileitCatalogGroupView | undefined = groupedEntries.get(groupKey);
      if (existingGroup === undefined) {
        groupedEntries.set(groupKey, {
          key: groupKey,
          name: groupName,
          entries: [entry],
        });
        return;
      }

      existingGroup.entries.push(entry);
    });
  });

  return [...groupedEntries.values()]
    .map((group: SmileitCatalogGroupView) => ({
      ...group,
      entries: [...group.entries].sort(
        (left: SmileitCatalogEntryView, right: SmileitCatalogEntryView) =>
          left.name.localeCompare(right.name),
      ),
    }))
    .sort((left: SmileitCatalogGroupView, right: SmileitCatalogGroupView) =>
      left.name.localeCompare(right.name),
    );
}

// ---------------------------------------------------------------------------
// Nombres secuenciales para borradores de catálogo
// ---------------------------------------------------------------------------

/**
 * Genera el siguiente nombre para clon con formato "<base>_susN".
 * Ejemplo: catecol → catecol_sus2 → catecol_sus3.
 */
export function buildNextCloneDraftName(sourceName: string, existingNames: string[]): string {
  const normalizedSourceName: string = sourceName.trim();
  const sourceMatch = /^(.*?)(?:_sus(\d+))?$/i.exec(normalizedSourceName);
  const rawBaseName: string = (sourceMatch?.[1] ?? normalizedSourceName).trim();
  const baseName: string = rawBaseName === '' ? 'substituent' : rawBaseName;

  let maxIndex: number = 1;
  const escapedBaseName: string = escapeRegExp(baseName);
  const suffixPattern: RegExp = new RegExp(String.raw`^${escapedBaseName}_sus(\d+)$`, 'i');

  existingNames.forEach((existingName: string) => {
    const normalizedExistingName: string = existingName.trim();
    if (
      normalizedExistingName.localeCompare(baseName, undefined, { sensitivity: 'accent' }) === 0
    ) {
      maxIndex = Math.max(maxIndex, 1);
      return;
    }

    const existingMatch: RegExpMatchArray | null = suffixPattern.exec(normalizedExistingName);
    if (existingMatch === null) {
      return;
    }

    const parsedIndex: number = Number(existingMatch[1]);
    if (Number.isFinite(parsedIndex)) {
      maxIndex = Math.max(maxIndex, parsedIndex);
    }
  });

  return `${baseName}_sus${maxIndex + 1}`;
}

/** Genera el siguiente nombre secuencial "<base> N" (ej: "Substituent 1" → "Substituent 2"). */
export function buildNextSequentialCatalogDraftName(
  sourceName: string,
  existingNames: string[],
): string {
  const normalizedSourceName: string = sourceName.trim();
  const sourceMatch: RegExpMatchArray | null = /^(.*?)(?:\s+(\d+))?$/.exec(normalizedSourceName);
  const rawBaseName: string = (sourceMatch?.[1] ?? normalizedSourceName).trim();
  const baseName: string = rawBaseName === '' ? 'Substituent' : rawBaseName;
  const escapedBaseName: string = escapeRegExp(baseName);
  const suffixPattern: RegExp = new RegExp(String.raw`^${escapedBaseName}(?:\s+(\d+))?$`, 'i');

  let highestSuffix: number = 0;

  existingNames.forEach((existingName: string) => {
    const normalizedExistingName: string = existingName.trim();
    const existingMatch: RegExpMatchArray | null = suffixPattern.exec(normalizedExistingName);
    if (existingMatch === null) {
      return;
    }

    const parsedSuffix: number = existingMatch[1] === undefined ? 1 : Number(existingMatch[1]);
    if (Number.isFinite(parsedSuffix)) {
      highestSuffix = Math.max(highestSuffix, parsedSuffix);
    }
  });

  return `${baseName} ${Math.max(1, highestSuffix + 1)}`;
}

// ---------------------------------------------------------------------------
// Cobertura efectiva de bloques sobre posiciones seleccionadas
// ---------------------------------------------------------------------------

/** Calcula la cobertura de cada sitio seleccionado por los bloques de asignación. */
export function buildEffectiveCoverage(
  selectedSites: number[],
  blocks: SmileitAssignmentBlockDraft[],
): SmileitSiteCoverageView[] {
  const selectedSiteSet: Set<number> = new Set(selectedSites);
  const coverageMap: Map<number, SmileitSiteCoverageView> = new Map();

  blocks.forEach((block: SmileitAssignmentBlockDraft, index: number) => {
    const sourceCount: number =
      block.categoryKeys.length + block.catalogRefs.length + block.manualSubstituents.length;
    if (sourceCount === 0) {
      return;
    }

    block.siteAtomIndices.forEach((siteAtomIndex: number) => {
      if (!selectedSiteSet.has(siteAtomIndex)) {
        return;
      }

      const previousCoverage: SmileitSiteCoverageView | undefined = coverageMap.get(siteAtomIndex);
      if (previousCoverage !== undefined) {
        coverageMap.set(siteAtomIndex, {
          ...previousCoverage,
          sourceCount: previousCoverage.sourceCount + sourceCount,
        });
        return;
      }

      coverageMap.set(siteAtomIndex, {
        siteAtomIndex,
        blockId: block.id,
        blockLabel: block.label.trim() || `Block ${index + 1}`,
        priority: index + 1,
        sourceCount,
      });
    });
  });

  return [...coverageMap.values()].sort(
    (left: SmileitSiteCoverageView, right: SmileitSiteCoverageView) =>
      left.siteAtomIndex - right.siteAtomIndex,
  );
}

/** Aviso cuando la combinatoria estimada supera este número de derivados. */
export const COMBINATORIAL_WARNING_THRESHOLD = 1_000;
/** Tope duro: por encima no se permite ejecutar (nunca se trunca la generación). */
export const COMBINATORIAL_HARD_LIMIT = 1_000_000;

/**
 * Estimación combinatoria de derivados: suma de los coeficientes simétricos
 * elementales e_k para k = 1..r (subconjunto de sitios × asignación de un
 * sustituyente por sitio), sin el factor k!.
 *
 * Es una cota superior de **moléculas distintas**: el generador deduplica por
 * SMILES canónico, así que las secuencias de fusión ordenadas no cuentan.
 * Los intentos reales de fusión son hasta r! veces esa cifra.
 * Misma fórmula que el backend para que aviso y bloqueo coincidan.
 */
export function estimateCombinatorialTotal(
  optionsPerSite: readonly number[],
  rSubstitutes: number,
): number {
  const usableOptions: number[] = optionsPerSite.filter((options: number) => options > 0);
  if (usableOptions.length === 0) {
    return 0;
  }

  const maxRounds: number = Math.max(1, Math.min(Math.trunc(rSubstitutes), usableOptions.length));
  let subsetProducts: number[] = [1];
  for (const optionsInSite of usableOptions) {
    const updatedProducts: number[] = subsetProducts.concat(0);
    for (let index = subsetProducts.length - 1; index > 0; index -= 1) {
      updatedProducts[index] = subsetProducts[index] + subsetProducts[index - 1] * optionsInSite;
    }
    updatedProducts[subsetProducts.length] = (subsetProducts.at(-1) ?? 0) * optionsInSite;
    subsetProducts = updatedProducts.slice(0, maxRounds + 1);
  }

  let total: number = 0;
  for (let roundIndex = 1; roundIndex <= maxRounds; roundIndex += 1) {
    total += subsetProducts[roundIndex];
    if (total > COMBINATORIAL_HARD_LIMIT) {
      return COMBINATORIAL_HARD_LIMIT + 1;
    }
  }

  return total;
}

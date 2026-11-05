// smileit risk utils: Categorías de riesgo de los patrones de Smile-it.
// Traduce la metadata de procedencia del patrón a una categoría estable y agrupa
// las anotaciones de una inspección para la leyenda del visor principal.

import type {
  SmileitPatternEntryView,
  SmileitStructuralAnnotationView,
} from '../core/api/jobs-api.service';

/** Clave de `provenance_metadata` donde el backend expone la categoría de riesgo. */
export const RISK_CATEGORY_METADATA_KEY = 'risk_category';

/** Categoría reservada para los andamios privilegiados (verde). */
export const PRIVILEGED_CATEGORY_KEY = 'privileged_scaffold';

/** Categoría de respaldo cuando el patrón no declara una categoría conocida. */
export const OTHER_CATEGORY_KEY = 'other';

/** Color de los patrones toxicofóricos definido por el backend. */
export const TOXICOPHORE_CATEGORY_COLOR = '#d93a2f';

/** Color de los andamios privilegiados definido por el backend. */
export const PRIVILEGED_CATEGORY_COLOR = '#2f9e44';

export type RiskCategoryKey =
  | 'hepatotoxicity'
  | 'reactivity'
  | 'metabolic_interference'
  | 'mutagenicity_ames'
  | 'herg_cardiotoxicity'
  | 'genotoxicity'
  | 'privileged_scaffold'
  | 'other';

/** Orden estable de presentación de categorías en la UI. */
export const RISK_CATEGORY_KEYS: readonly RiskCategoryKey[] = [
  'hepatotoxicity',
  'reactivity',
  'metabolic_interference',
  'mutagenicity_ames',
  'herg_cardiotoxicity',
  'genotoxicity',
  'other',
  'privileged_scaffold',
];

/** Grupo de patrones de catálogo que comparten una categoría de riesgo. */
export interface RiskCategoryGroupView {
  key: RiskCategoryKey;
  patterns: SmileitPatternEntryView[];
  isEnabled: boolean;
  matchCount: number;
}

/** Grupo de anotaciones de la inspección actual que comparten categoría. */
export interface AnnotationLegendGroupView {
  key: RiskCategoryKey;
  annotations: SmileitStructuralAnnotationView[];
  isEnabled: boolean;
}

const RISK_CATEGORY_KEY_SET: ReadonlySet<string> = new Set<string>(RISK_CATEGORY_KEYS);

/** Indica si un valor arbitrario de metadata es una categoría conocida. */
export function isKnownRiskCategory(value: string): value is RiskCategoryKey {
  return RISK_CATEGORY_KEY_SET.has(value);
}

/**
 * Resuelve la categoría de un patrón a partir de su metadata de procedencia.
 * Fallback: `privileged_scaffold` si el tipo del patrón es `privileged`, si no `other`.
 */
export function resolvePatternRiskCategory(pattern: SmileitPatternEntryView): RiskCategoryKey {
  const rawCategory: string = pattern.provenance_metadata?.[RISK_CATEGORY_METADATA_KEY] ?? '';
  if (isKnownRiskCategory(rawCategory)) {
    return rawCategory;
  }

  return pattern.pattern_type === 'privileged' ? PRIVILEGED_CATEGORY_KEY : OTHER_CATEGORY_KEY;
}

/**
 * Resuelve la categoría de una anotación usando el catálogo de patrones.
 * Las anotaciones no llevan metadata de procedencia, así que se busca su patrón por
 * `stable_id`; si no está en el catálogo se usa el tipo de patrón de la anotación.
 */
export function resolveAnnotationRiskCategory(
  annotation: SmileitStructuralAnnotationView,
  patternCategoryByStableId: ReadonlyMap<string, RiskCategoryKey>,
): RiskCategoryKey {
  const categoryFromPattern: RiskCategoryKey | undefined = patternCategoryByStableId.get(
    annotation.pattern_stable_id,
  );
  if (categoryFromPattern !== undefined) {
    return categoryFromPattern;
  }

  return annotation.pattern_type === 'privileged' ? PRIVILEGED_CATEGORY_KEY : OTHER_CATEGORY_KEY;
}

/** Color asociado a una categoría para pintar chips y encabezados. */
export function riskCategoryColor(categoryKey: RiskCategoryKey): string {
  return categoryKey === PRIVILEGED_CATEGORY_KEY
    ? PRIVILEGED_CATEGORY_COLOR
    : TOXICOPHORE_CATEGORY_COLOR;
}

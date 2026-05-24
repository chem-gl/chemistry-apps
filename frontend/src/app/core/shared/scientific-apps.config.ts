// scientific-apps.config.ts: Registro frontend de apps cientificas navegables.
// Los titulos y descripciones se traducen via i18n usando la clave
// `scientificApps.<key>.title` y `scientificApps.<key>.description` en los templates.
// Los campos `title`/`description` sirven como fallback en ingles.

export interface ScientificAppRouteItem {
  key: string;
  pluginName: string;
  /** Titulo traducible via i18n: `scientificApps.<key>.title` */
  title: string;
  /** Descripcion traducible via i18n: `scientificApps.<key>.description` */
  description: string;
  routePath: string;
  available: boolean;
  /** Si es false, la app no se muestra en menus ni en el hub (solo existe como ejemplo/ruta interna). */
  visibleInMenus: boolean;
}

interface ScientificAppDefinition {
  key: string;
  pluginName: string;
  title: string;
  description: string;
  visibleInMenus: boolean;
}

function createScientificAppRouteItem(definition: ScientificAppDefinition): ScientificAppRouteItem {
  return {
    key: definition.key,
    pluginName: definition.pluginName,
    title: definition.title,
    description: definition.description,
    routePath: `/${definition.key}`,
    available: true,
    visibleInMenus: definition.visibleInMenus,
  };
}

/** Clave i18n para el titulo de una app. Se usa en templates via `| transloco`. */
export function scientificAppTitleKey(appKey: string): string {
  return `scientificApps.${appKey}.title`;
}

/** Clave i18n para la descripcion de una app. Se usa en templates via `| transloco`. */
export function scientificAppDescriptionKey(appKey: string): string {
  return `scientificApps.${appKey}.description`;
}

const SCIENTIFIC_APP_DEFINITIONS: ReadonlyArray<ScientificAppDefinition> = [
  {
    key: 'molar-fractions',
    pluginName: 'molar-fractions',
    title: 'Molar Fractions',
    description: 'Acid-base equilibrium molar fractions with f0..fn table and detailed logs.',
    visibleInMenus: true,
  },
  {
    key: 'tunnel',
    pluginName: 'tunnel-effect',
    title: 'Tunnel Effect',
    description:
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    visibleInMenus: true,
  },
  {
    key: 'easy-rate',
    pluginName: 'easy-rate',
    title: 'Easy-rate',
    description:
      'TST + Eckart tunnel rate constants from Gaussian log files with optional diffusion correction.',
    visibleInMenus: true,
  },
  {
    key: 'marcus',
    pluginName: 'marcus-kinetics',
    title: 'Marcus Theory',
    description:
      'Marcus energies, reorganization energy, barrier and rate constants from six Gaussian log files.',
    visibleInMenus: true,
  },
  {
    key: 'smileit',
    pluginName: 'smileit',
    title: 'Smileit',
    description:
      'Combinatorial SMILES generation with atom-index inspection, substituent catalog and report exports.',
    visibleInMenus: true,
  },
  {
    key: 'sa-score',
    pluginName: 'sa-score',
    title: 'SA Score',
    description:
      'Synthetic accessibility scoring for SMILES batches using AMBIT, BRSAScore and RDKit methods.',
    visibleInMenus: true,
  },
  {
    key: 'toxicity-properties',
    pluginName: 'toxicity-properties',
    title: 'Toxicity Properties',
    description:
      'ADMET-AI toxicity table for LD50, Ames mutagenicity and developmental toxicity from SMILES batches.',
    visibleInMenus: true,
  },
  {
    key: 'cadma-py',
    pluginName: 'cadma-py',
    title: 'CADMA Py',
    description:
      'Reference-family management, transparent selection scores and ergonomic comparison charts for compound prioritization.',
    visibleInMenus: true,
  },
];

export const SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_DEFINITIONS.map(createScientificAppRouteItem);

export function findScientificAppRouteItemByRouteKey(
  routeKey: string,
): ScientificAppRouteItem | undefined {
  return SCIENTIFIC_APP_ROUTE_ITEMS.find((appItem) => appItem.key === routeKey);
}

export function findScientificAppRouteItemByPluginName(
  pluginName: string,
): ScientificAppRouteItem | undefined {
  return SCIENTIFIC_APP_ROUTE_ITEMS.find((appItem) => appItem.pluginName === pluginName);
}

export function resolveScientificJobRouteKey(pluginName: string): string | null {
  return findScientificAppRouteItemByPluginName(pluginName)?.key ?? null;
}

export function resolveScientificJobRoutePath(pluginName: string): string | null {
  const routeKey = resolveScientificJobRouteKey(pluginName);
  if (routeKey === null) {
    return null;
  }

  return findScientificAppRouteItemByRouteKey(routeKey)?.routePath ?? null;
}

/** Lista filtrada: solo las apps visibles en menus y en el hub. */
export const VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.visibleInMenus);

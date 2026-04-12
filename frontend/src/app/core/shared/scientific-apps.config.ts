// scientific-apps.config.ts: Registro frontend de apps cientificas navegables.

export interface ScientificAppRouteItem {
  key: string;
  title: string;
  description: string;
  routePath: string;
  available: boolean;
  /** Si es false, la app no se muestra en menus ni en el hub (solo existe como ejemplo/ruta interna). */
  visibleInMenus: boolean;
}

interface ScientificAppDefinition {
  key: string;
  title: string;
  description: string;
  visibleInMenus: boolean;
}

function createScientificAppRouteItem(definition: ScientificAppDefinition): ScientificAppRouteItem {
  return {
    key: definition.key,
    title: definition.title,
    description: definition.description,
    routePath: `/${definition.key}`,
    available: true,
    visibleInMenus: definition.visibleInMenus,
  };
}

const SCIENTIFIC_APP_DEFINITIONS: ReadonlyArray<ScientificAppDefinition> = [
  {
    key: 'random-numbers',
    title: 'Random Numbers',
    description: 'Batch random number generation with URL seed and progress tracking.',
    visibleInMenus: false,
  },
  {
    key: 'molar-fractions',
    title: 'Molar Fractions',
    description: 'Acid-base equilibrium molar fractions with f0..fn table and detailed logs.',
    visibleInMenus: true,
  },
  {
    key: 'tunnel',
    title: 'Tunnel Effect',
    description:
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    visibleInMenus: true,
  },
  {
    key: 'easy-rate',
    title: 'Easy-rate',
    description:
      'TST + Eckart tunnel rate constants from Gaussian log files with optional diffusion correction.',
    visibleInMenus: true,
  },
  {
    key: 'marcus',
    title: 'Marcus Theory',
    description:
      'Marcus energies, reorganization energy, barrier and rate constants from six Gaussian log files.',
    visibleInMenus: true,
  },
  {
    key: 'smileit',
    title: 'Smileit',
    description:
      'Combinatorial SMILES generation with atom-index inspection, substituent catalog and report exports.',
    visibleInMenus: true,
  },
  {
    key: 'sa-score',
    title: 'SA Score',
    description:
      'Synthetic accessibility scoring for SMILES batches using AMBIT, BRSAScore and RDKit methods.',
    visibleInMenus: true,
  },
  {
    key: 'toxicity-properties',
    title: 'Toxicity Properties',
    description:
      'ADMET-AI toxicity table for LD50, Ames mutagenicity and developmental toxicity from SMILES batches.',
    visibleInMenus: true,
  },
];

export const SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_DEFINITIONS.map(createScientificAppRouteItem);

const SCIENTIFIC_JOB_PLUGIN_ROUTE_KEY_MAP: Readonly<Record<string, string>> = {
  'random-numbers': 'random-numbers',
  'molar-fractions': 'molar-fractions',
  'tunnel-effect': 'tunnel',
  'easy-rate': 'easy-rate',
  marcus: 'marcus',
  smileit: 'smileit',
  'sa-score': 'sa-score',
  'toxicity-properties': 'toxicity-properties',
};

export function resolveScientificJobRouteKey(pluginName: string): string | null {
  return SCIENTIFIC_JOB_PLUGIN_ROUTE_KEY_MAP[pluginName] ?? null;
}

export function resolveScientificJobRoutePath(pluginName: string): string | null {
  const routeKey = resolveScientificJobRouteKey(pluginName);
  if (routeKey === null) {
    return null;
  }

  return SCIENTIFIC_APP_ROUTE_ITEMS.find((appItem) => appItem.key === routeKey)?.routePath ?? null;
}

/** Lista filtrada: solo las apps visibles en menus y en el hub. */
export const VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.visibleInMenus);

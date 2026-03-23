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

export const SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> = [
  {
    key: 'calculator',
    title: 'Calculator',
    description: 'Arithmetic operations with asynchronous execution and cache support.',
    routePath: '/calculator',
    available: true,
    visibleInMenus: false,
  },
  {
    key: 'random-numbers',
    title: 'Random Numbers',
    description: 'Batch random number generation with URL seed and progress tracking.',
    routePath: '/random-numbers',
    available: true,
    visibleInMenus: false,
  },
  {
    key: 'molar-fractions',
    title: 'Molar Fractions',
    description: 'Acid-base equilibrium molar fractions with f0..fn table and detailed logs.',
    routePath: '/molar-fractions',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'tunnel',
    title: 'Tunnel Effect',
    description:
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    routePath: '/tunnel',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'easy-rate',
    title: 'Easy-rate',
    description:
      'TST + Eckart tunnel rate constants from Gaussian log files with optional diffusion correction.',
    routePath: '/easy-rate',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'marcus',
    title: 'Marcus Theory',
    description:
      'Marcus energies, reorganization energy, barrier and rate constants from six Gaussian log files.',
    routePath: '/marcus',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'smileit',
    title: 'Smileit',
    description:
      'Combinatorial SMILES generation with atom-index inspection, substituent catalog and report exports.',
    routePath: '/smileit',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'sa-score',
    title: 'SA Score',
    description:
      'Synthetic accessibility scoring for SMILES batches using AMBIT, BRSAScore and RDKit methods.',
    routePath: '/sa-score',
    available: true,
    visibleInMenus: true,
  },
  {
    key: 'toxicity-properties',
    title: 'Toxicity Properties',
    description:
      'ADMET-AI toxicity table for LD50, Ames mutagenicity and developmental toxicity from SMILES batches.',
    routePath: '/toxicity-properties',
    available: true,
    visibleInMenus: true,
  },
];

/** Lista filtrada: solo las apps visibles en menus y en el hub. Calculator y Random Numbers quedan excluidas. */
export const VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.visibleInMenus);

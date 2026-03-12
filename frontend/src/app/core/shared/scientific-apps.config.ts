// scientific-apps.config.ts: Registro frontend de apps cientificas navegables.

export interface ScientificAppRouteItem {
  key: string;
  title: string;
  description: string;
  routePath: string;
  available: boolean;
}

export const SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> = [
  {
    key: 'calculator',
    title: 'Calculator',
    description: 'Arithmetic operations with asynchronous execution and cache support.',
    routePath: '/calculator',
    available: true,
  },
  {
    key: 'random-numbers',
    title: 'Random Numbers',
    description: 'Batch random number generation with URL seed and progress tracking.',
    routePath: '/random-numbers',
    available: true,
  },
  {
    key: 'molar-fractions',
    title: 'Molar Fractions',
    description: 'Acid-base equilibrium molar fractions with f0..fn table and detailed logs.',
    routePath: '/molar-fractions',
    available: true,
  },
  {
    key: 'tunnel',
    title: 'Tunnel Effect',
    description:
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    routePath: '/tunnel',
    available: true,
  },
  {
    key: 'easy-rate',
    title: 'Easy-rate',
    description:
      'TST + Eckart tunnel rate constants from Gaussian log files with optional diffusion correction.',
    routePath: '/easy-rate',
    available: true,
  },
  {
    key: 'marcus',
    title: 'Marcus Theory',
    description:
      'Marcus energies, reorganization energy, barrier and rate constants from six Gaussian log files.',
    routePath: '/marcus',
    available: true,
  },
];

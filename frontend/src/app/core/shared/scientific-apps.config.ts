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
    title: 'Calculadora',
    description: 'Operaciones aritmeticas con ejecucion asincrona y cache.',
    routePath: '/calculator',
    available: true,
  },
  {
    key: 'random-numbers',
    title: 'Random Numbers',
    description: 'Generacion de numeros aleatorios por lotes con semilla URL y progreso.',
    routePath: '/random-numbers',
    available: true,
  },
];

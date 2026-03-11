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
    key: 'future-kinetics',
    title: 'Nueva app (proxima)',
    description: 'Espacio reservado para futuras apps cientificas desacopladas.',
    routePath: '/apps',
    available: false,
  },
];

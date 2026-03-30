// marcus-api.types.ts: Tipos de la app Marcus para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho de jobs Marcus.

import { MarcusJobResponse } from '../generated';

/** Parámetros de entrada para crear un job Marcus con 6 archivos Gaussian */
export interface MarcusParams {
  reactant1File: File;
  reactant2File: File;
  product1AdiabaticFile: File;
  product2AdiabaticFile: File;
  product1VerticalFile: File;
  product2VerticalFile: File;
  title?: string;
  diffusion?: boolean;
  radiusReactant1?: number;
  radiusReactant2?: number;
  reactionDistance?: number;
  version?: string;
}

export type MarcusJobResponseView = MarcusJobResponse;

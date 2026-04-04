// molar-fractions-api.types.ts: Tipos de la app Molar Fractions para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho de jobs de fracciones molares.

/** Parámetros de entrada para crear un job de fracciones molares */
export interface MolarFractionsParams {
  pkaValues: number[];
  phMode: 'single' | 'range';
  phValue?: number;
  phMin?: number;
  phMax?: number;
  phStep?: number;
  version?: string;
}

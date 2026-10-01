// server-calc-api.types.ts: Tipos de la app Server Calc (cálculo remoto) para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho de Server Calc.

/** Operadores soportados por el cálculo remoto. */
export type ServerCalcOperatorParam = '+' | '-' | '*' | '/';

/** Parámetros de entrada para crear un job de cálculo remoto */
export interface ServerCalcParams {
  a: number;
  op: ServerCalcOperatorParam;
  b: number;
  version?: string;
}

// calculator-api.types.ts: Tipos de la app Calculator para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho o respuestas de calculadora.

import { CalculatorJobResponse, CalculatorOperationEnum } from '../generated';

/**
 * Parámetros de entrada para crear un job de calculadora.
 *
 * - `op`: operación a ejecutar. 'factorial' usa solo `a` e ignora `b`.
 * - `a`: primer operando (base en pow, único en factorial).
 * - `b`: segundo operando; obligatorio para add/sub/mul/div/pow; omitir en factorial.
 */
export interface CalculatorParams {
  op: CalculatorOperationEnum;
  a: number;
  b?: number;
}

export type CalculatorJobResponseView = CalculatorJobResponse;
export type CalculatorOperationView = CalculatorOperationEnum;

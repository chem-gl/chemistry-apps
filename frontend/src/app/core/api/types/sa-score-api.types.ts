// sa-score-api.types.ts: Tipos de la app SA Score para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho o respuestas de SA Score.

import { MethodsEnum, SaMoleculeResult, SaScoreJobResponse } from '../generated';
import { NamedSmilesJobMolecule } from './named-smiles-api.types';

/** Métodos soportados para cálculo SA score en backend. */
export type SaScoreMethod = MethodsEnum;

/** Payload tipado para crear jobs de SA score desde UI. */
export interface SaScoreParams {
  molecules: NamedSmilesJobMolecule[];
  methods: SaScoreMethod[];
  version?: string;
}

/** Fila normalizada para la tabla de resultados de SA score. */
export type SaScoreMoleculeResultView = SaMoleculeResult;

/** Respuesta tipada de job SA score para workflows y componentes. */
export type SaScoreJobResponseView = SaScoreJobResponse;

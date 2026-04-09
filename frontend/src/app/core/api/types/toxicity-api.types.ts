// toxicity-api.types.ts: Tipos de la app Toxicity Properties para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho o respuestas de toxicidad.

import { ToxicityJobResponse, ToxicityMoleculeResult } from '../generated';
import { NamedSmilesJobMolecule } from './named-smiles-api.types';

/** Payload tipado para crear jobs de Toxicity Properties desde UI. */
export interface ToxicityPropertiesParams {
  molecules: NamedSmilesJobMolecule[];
  version?: string;
}

/** Fila normalizada para la tabla toxicológica fija (alias del tipo generado). */
export type ToxicityMoleculeResultView = ToxicityMoleculeResult;

/** Respuesta tipada de job de Toxicity Properties para workflows y componentes. */
export type ToxicityJobResponseView = ToxicityJobResponse;

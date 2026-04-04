// easy-rate-api.types.ts: Tipos de la app Easy-rate para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho, inspección Gaussian o respuestas Easy-rate.

import { EasyRateJobResponse } from '../generated';

/** Parámetros de entrada para crear un job Easy-rate con archivos Gaussian */
export interface EasyRateParams {
  transitionStateFile: File;
  reactant1File: File;
  reactant2File: File;
  product1File?: File;
  product2File?: File;
  transitionStateExecutionIndex?: number;
  reactant1ExecutionIndex?: number;
  reactant2ExecutionIndex?: number;
  product1ExecutionIndex?: number;
  product2ExecutionIndex?: number;
  title?: string;
  reactionPathDegeneracy?: number;
  cageEffects?: boolean;
  diffusion?: boolean;
  solvent?: string;
  customViscosity?: number;
  radiusReactant1?: number;
  radiusReactant2?: number;
  reactionDistance?: number;
  printDataInput?: boolean;
  version?: string;
}

/** Campos Gaussian soportados por Easy-rate para inspección y selección. */
export type EasyRateInputFieldName =
  | 'transition_state_file'
  | 'reactant_1_file'
  | 'reactant_2_file'
  | 'product_1_file'
  | 'product_2_file';

/** Resumen normalizado de una ejecución candidata detectada en un archivo Gaussian. */
export interface EasyRateInspectionExecutionView {
  sourceField: EasyRateInputFieldName;
  originalFilename: string | null;
  executionIndex: number;
  jobTitle: string | null;
  checkpointFile: string | null;
  charge: number;
  multiplicity: number;
  freeEnergy: number | null;
  thermalEnthalpy: number | null;
  zeroPointEnergy: number | null;
  scfEnergy: number | null;
  temperature: number | null;
  negativeFrequencies: number;
  imaginaryFrequency: number | null;
  normalTermination: boolean;
  isOptFreq: boolean;
  isValidForRole: boolean;
  validationErrors: string[];
}

/** Resultado de inspección previa de un archivo Gaussian en la UI de Easy-rate. */
export interface EasyRateFileInspectionView {
  sourceField: EasyRateInputFieldName;
  originalFilename: string | null;
  parseErrors: string[];
  executionCount: number;
  defaultExecutionIndex: number | null;
  executions: EasyRateInspectionExecutionView[];
}

export type EasyRateJobResponseView = EasyRateJobResponse;

// easy-rate-workflow.types.ts: Tipos, interfaces y constantes para el workflow de Easy-rate.
// Define los tipos de señal de inspección, el resultado mapeado y las opciones de solvente.

import { EasyRateFileInspectionView, EasyRateInputFieldName } from '../api/jobs-api.service';

export type EasyRateInspectionMap = Record<
  EasyRateInputFieldName,
  EasyRateFileInspectionView | null
>;
export type EasyRateInspectionLoadingMap = Record<EasyRateInputFieldName, boolean>;
export type EasyRateInspectionErrorMap = Record<EasyRateInputFieldName, string | null>;
export type EasyRateExecutionSelectionMap = Record<EasyRateInputFieldName, number | null>;

export const EASY_RATE_FIELD_LABELS: Record<EasyRateInputFieldName, string> = {
  transition_state_file: 'Transition State',
  reactant_1_file: 'Reactant 1',
  reactant_2_file: 'Reactant 2',
  product_1_file: 'Product 1',
  product_2_file: 'Product 2',
};

/** Crea un record con todas las claves de EasyRateInputFieldName inicializadas por la función dada */
export function buildEasyRateFieldRecord<T>(
  createValue: () => T,
): Record<EasyRateInputFieldName, T> {
  return {
    transition_state_file: createValue(),
    reactant_1_file: createValue(),
    reactant_2_file: createValue(),
    product_1_file: createValue(),
    product_2_file: createValue(),
  };
}

/** Descriptor compacto de archivo de entrada para presentación en UI */
export interface EasyRateFileDescriptor {
  fieldName: string;
  originalFilename: string;
  sizeBytes: number;
}

/** Resultado mapeado de Easy-rate para consumo en la vista */
export interface EasyRateResultData {
  title: string;
  // Constantes de velocidad
  rateConstant: number | null;
  rateConstantTst: number | null;
  rateConstantDiffusionCorrected: number | null;
  kDiff: number | null;
  // Termodinámica (kcal/mol)
  gibbsReactionKcalMol: number;
  gibbsActivationKcalMol: number;
  enthalpyReactionKcalMol: number;
  enthalpyActivationKcalMol: number;
  zpeReactionKcalMol: number;
  zpeActivationKcalMol: number;
  // Corrección por túnel
  tunnelU: number | null;
  tunnelAlpha1: number | null;
  tunnelAlpha2: number | null;
  tunnelG: number | null;
  kappaTst: number;
  // Parámetros de condiciones de cálculo
  temperatureK: number;
  imaginaryFrequencyCm1: number;
  reactionPathDegeneracy: number;
  // Flags de resultado
  warnNegativeActivation: boolean;
  cageEffectsApplied: boolean;
  diffusionApplied: boolean;
  solventUsed: string;
  viscosityPaS: number | null;
  // Archivos de entrada persistidos
  fileDescriptors: EasyRateFileDescriptor[];
  // Estado histórico
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

/** Opciones de solvente disponibles para el formulario */
export const SOLVENT_OPTIONS: ReadonlyArray<string> = [
  'Gas phase (Air)',
  'Benzene',
  'Pentyl ethanoate',
  'Water',
  'Other',
];

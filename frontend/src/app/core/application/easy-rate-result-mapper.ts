// easy-rate-result-mapper.ts: Funciones puras para transformar EasyRateJobResponseView en EasyRateResultData.
// Convierte los datos crudos de la API en la estructura tipada usada por la vista.

import { EasyRateJobResponseView } from '../api/jobs-api.service';
import { EasyRateFileDescriptor, EasyRateResultData } from './easy-rate-workflow.types';

function buildFileDescriptors(jobResponse: EasyRateJobResponseView): EasyRateFileDescriptor[] {
  return jobResponse.parameters.file_descriptors.map((fd) => ({
    fieldName: fd.field_name,
    originalFilename: fd.original_filename,
    sizeBytes: fd.size_bytes,
  }));
}

/**
 * Extrae los datos de resultado de un job completado con payload válido.
 * Retorna null si el campo results es nulo o indefinido.
 */
export function extractEasyRateResultData(
  jobResponse: EasyRateJobResponseView,
): EasyRateResultData | null {
  const results = jobResponse.results;
  if (results === null || results === undefined) {
    return null;
  }
  const fileDescriptors = buildFileDescriptors(jobResponse);
  return {
    title: results.title,
    rateConstant: results.rate_constant,
    rateConstantTst: results.rate_constant_tst,
    rateConstantDiffusionCorrected: results.rate_constant_diffusion_corrected,
    kDiff: results.k_diff,
    gibbsReactionKcalMol: results.gibbs_reaction_kcal_mol,
    gibbsActivationKcalMol: results.gibbs_activation_kcal_mol,
    enthalpyReactionKcalMol: results.enthalpy_reaction_kcal_mol,
    enthalpyActivationKcalMol: results.enthalpy_activation_kcal_mol,
    zpeReactionKcalMol: results.zpe_reaction_kcal_mol,
    zpeActivationKcalMol: results.zpe_activation_kcal_mol,
    tunnelU: results.tunnel_u,
    tunnelAlpha1: results.tunnel_alpha_1,
    tunnelAlpha2: results.tunnel_alpha_2,
    tunnelG: results.tunnel_g,
    kappaTst: results.kappa_tst,
    temperatureK: results.temperature_k,
    imaginaryFrequencyCm1: results.imaginary_frequency_cm1,
    reactionPathDegeneracy: results.reaction_path_degeneracy,
    warnNegativeActivation: results.warn_negative_activation,
    cageEffectsApplied: results.cage_effects_applied,
    diffusionApplied: results.diffusion_applied,
    solventUsed: results.solvent_used,
    viscosityPaS: results.viscosity_pa_s,
    fileDescriptors,
    isHistoricalSummary: false,
    summaryMessage: null,
  };
}

/**
 * Construye un resumen de datos para jobs históricos sin payload de resultados.
 * summaryMessage debe provenir de buildHistoricalSummaryMessage() del servicio base.
 */
export function buildEasyRateSummaryData(
  jobResponse: EasyRateJobResponseView,
  summaryMessage: string | null,
): EasyRateResultData {
  const params = jobResponse.parameters;
  const fileDescriptors = buildFileDescriptors(jobResponse);
  return {
    title: params.title,
    rateConstant: null,
    rateConstantTst: null,
    rateConstantDiffusionCorrected: null,
    kDiff: null,
    gibbsReactionKcalMol: 0,
    gibbsActivationKcalMol: 0,
    enthalpyReactionKcalMol: 0,
    enthalpyActivationKcalMol: 0,
    zpeReactionKcalMol: 0,
    zpeActivationKcalMol: 0,
    tunnelU: null,
    tunnelAlpha1: null,
    tunnelAlpha2: null,
    tunnelG: null,
    kappaTst: 0,
    temperatureK: 0,
    imaginaryFrequencyCm1: 0,
    reactionPathDegeneracy: params.reaction_path_degeneracy,
    warnNegativeActivation: false,
    cageEffectsApplied: params.cage_effects,
    diffusionApplied: params.diffusion,
    solventUsed: params.solvent,
    viscosityPaS: params.custom_viscosity,
    fileDescriptors,
    isHistoricalSummary: true,
    summaryMessage,
  };
}

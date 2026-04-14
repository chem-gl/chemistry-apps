// scientific-job-name.utils.ts: Utilidades compartidas para resolver, persistir y mostrar
// nombres visibles de jobs científicos en apps que no exponen un campo title en backend.

import { NamedSmilesInputRow } from './scientific-app-ui.utils';

const SCIENTIFIC_JOB_NAME_STORAGE_KEY = 'chemistry-apps.scientific-job-names';

type PersistedScientificJobNames = Record<string, Record<string, string>>;

export function resolveScientificJobNameCandidate(
  rawJobName: string | null | undefined,
  rows: NamedSmilesInputRow[],
): string | null {
  const trimmedJobName: string = rawJobName?.trim() ?? '';
  if (trimmedJobName !== '') {
    return trimmedJobName;
  }

  const firstNamedRow: NamedSmilesInputRow | undefined = rows.find((rowValue) => {
    const normalizedName: string = rowValue.name.trim();
    const normalizedSmiles: string = rowValue.smiles.trim();
    return normalizedName !== '' && normalizedName !== normalizedSmiles;
  });

  return firstNamedRow?.name.trim() ?? null;
}

export function buildScientificJobDisplayName(
  jobId: string,
  rawJobName: string | null | undefined,
): string {
  const trimmedJobName: string = rawJobName?.trim() ?? '';
  return trimmedJobName === '' ? jobId : `${trimmedJobName}_${jobId}`;
}

export function extractScientificJobNameFromParameters(parameters: unknown): string | null {
  if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return null;
  }

  const candidateParameters = parameters as {
    job_name?: unknown;
    molecules?: unknown;
  };

  if (
    typeof candidateParameters.job_name === 'string' &&
    candidateParameters.job_name.trim() !== ''
  ) {
    return candidateParameters.job_name.trim();
  }

  if (!Array.isArray(candidateParameters.molecules)) {
    return null;
  }

  const firstMolecule: unknown = candidateParameters.molecules[0];
  if (firstMolecule === null || typeof firstMolecule !== 'object' || Array.isArray(firstMolecule)) {
    return null;
  }

  const candidateMolecule = firstMolecule as {
    name?: unknown;
    smiles?: unknown;
  };
  const candidateName: string =
    typeof candidateMolecule.name === 'string' ? candidateMolecule.name.trim() : '';
  const candidateSmiles: string =
    typeof candidateMolecule.smiles === 'string' ? candidateMolecule.smiles.trim() : '';

  if (candidateName === '' || candidateName === candidateSmiles) {
    return null;
  }

  return candidateName;
}

export function readPersistedScientificJobName(pluginName: string, jobId: string): string | null {
  try {
    const rawRegistry: string | null =
      globalThis.localStorage?.getItem(SCIENTIFIC_JOB_NAME_STORAGE_KEY) ?? null;
    if (rawRegistry === null || rawRegistry.trim() === '') {
      return null;
    }

    const registry = JSON.parse(rawRegistry) as PersistedScientificJobNames;
    const storedValue: string | undefined = registry[pluginName]?.[jobId];
    return typeof storedValue === 'string' && storedValue.trim() !== '' ? storedValue.trim() : null;
  } catch {
    return null;
  }
}

export function persistScientificJobName(
  pluginName: string,
  jobId: string,
  rawJobName: string | null | undefined,
): void {
  const trimmedJobName: string = rawJobName?.trim() ?? '';
  if (trimmedJobName === '') {
    return;
  }

  try {
    const rawRegistry: string | null =
      globalThis.localStorage?.getItem(SCIENTIFIC_JOB_NAME_STORAGE_KEY) ?? null;
    const registry: PersistedScientificJobNames = rawRegistry ? JSON.parse(rawRegistry) : {};
    const pluginRegistry: Record<string, string> = registry[pluginName] ?? {};
    pluginRegistry[jobId] = trimmedJobName;
    registry[pluginName] = pluginRegistry;
    globalThis.localStorage?.setItem(SCIENTIFIC_JOB_NAME_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Ignorar fallos de persistencia local para no bloquear el flujo del job.
  }
}

export function resolveScientificJobNameForHistory(
  pluginName: string,
  jobId: string,
  parameters: unknown,
): string | null {
  const persistedName: string | null = readPersistedScientificJobName(pluginName, jobId);
  if (persistedName !== null) {
    return persistedName;
  }

  return extractScientificJobNameFromParameters(parameters);
}

// generation-result-naming.utils.ts: Reglas compartidas de naming para panel, exports y ZIP de Smile-it.

const DEFAULT_JOB_NAME = 'SMILEIT';
const DEFAULT_SCAFFOLD_LABEL = 'Scaffold';

/** Normaliza el nombre del trabajo para reutilizarlo en identificadores y archivos. */
export function normalizeJobNameIdentifier(rawJobName: string | null | undefined): string {
  const trimmedJobName = rawJobName?.trim() ?? '';
  const safeJobName = trimmedJobName === '' ? DEFAULT_JOB_NAME : trimmedJobName;

  return (
    safeJobName
      .replaceAll(/[^a-zA-Z0-9_-]+/g, '_')
      .replaceAll(/_+/g, '_')
      .replace(/^_/, '')
      .replace(/_$/, '') || DEFAULT_JOB_NAME
  );
}

/** Devuelve la etiqueta visible del job para UI cuando existe un nombre configurable. */
export function resolveJobNameLabel(rawJobName: string | null | undefined): string {
  const trimmedJobName = rawJobName?.trim() ?? '';
  return trimmedJobName === '' ? DEFAULT_SCAFFOLD_LABEL : trimmedJobName;
}

/** Construye el nombre visible/canónico de un derivado. */
export function buildDerivativeDisplayName(
  rawJobName: string | null | undefined,
  ordinal: number,
): string {
  const normalizedJobName = normalizeJobNameIdentifier(rawJobName);
  const safeOrdinal = Math.max(1, Math.trunc(ordinal));
  return `d${normalizedJobName}${safeOrdinal}`;
}

/** Construye el identificador de la molécula principal usado en exports SMILES/TXT. */
export function buildPrincipalExportName(rawJobName: string | null | undefined): string {
  const normalizedJobName = normalizeJobNameIdentifier(rawJobName);
  return `${normalizedJobName} molecula principal`;
}

/** Construye el nombre de visualización del trabajo histórico con su id. */
export function buildHistoricalJobDisplayName(
  rawJobName: string | null | undefined,
  jobId: string,
): string {
  const visibleJobName = rawJobName?.trim() ? rawJobName.trim() : DEFAULT_JOB_NAME;
  return `${visibleJobName}_${jobId}`;
}

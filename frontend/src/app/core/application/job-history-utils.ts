// job-history-utils.ts: Utilidades compartidas para normalizar historial/listados de jobs.
// Centraliza la deduplicación por id conservando el snapshot más reciente por updated_at.

import type { ScientificJobView } from '../api/jobs-api.service';

/**
 * Devuelve un listado de jobs deduplicado por id y ordenado por updated_at descendente.
 * Si hay ids repetidos, conserva el snapshot más reciente con fallback seguro ante fechas inválidas.
 */
export const deduplicateJobsKeepingLatestSnapshot = (
  jobItems: ScientificJobView[],
): ScientificJobView[] => {
  const jobsById: Map<string, ScientificJobView> = new Map<string, ScientificJobView>();

  jobItems.forEach((jobItem: ScientificJobView) => {
    const currentJob: ScientificJobView | undefined = jobsById.get(jobItem.id);
    if (currentJob === undefined) {
      jobsById.set(jobItem.id, jobItem);
      return;
    }

    const currentUpdatedAt: number = Date.parse(currentJob.updated_at);
    const nextUpdatedAt: number = Date.parse(jobItem.updated_at);
    const shouldReplaceCurrent: boolean =
      Number.isFinite(nextUpdatedAt) &&
      (!Number.isFinite(currentUpdatedAt) || nextUpdatedAt >= currentUpdatedAt);

    if (shouldReplaceCurrent) {
      jobsById.set(jobItem.id, jobItem);
    }
  });

  return [...jobsById.values()].sort(
    (leftJob: ScientificJobView, rightJob: ScientificJobView) =>
      Date.parse(rightJob.updated_at) - Date.parse(leftJob.updated_at),
  );
};

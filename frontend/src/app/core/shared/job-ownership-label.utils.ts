// job-ownership-label.utils.ts: Utilidad compartida para construir la etiqueta owner/group de un job.

import { ScientificJobView } from '../api/jobs-api.service';

type JobOwnershipView = Pick<ScientificJobView, 'owner_username' | 'group_name'>;

/**
 * Construye una etiqueta consistente "owner · group" con fallback traducible.
 */
export function buildJobOwnershipLabel(
  jobItem: JobOwnershipView,
  translate: (translationKey: string) => string,
): string {
  const ownerLabel = jobItem.owner_username ?? translate('common.fallback.unknownUser');
  const groupLabel = jobItem.group_name ?? translate('common.fallback.noGroup');
  return `${ownerLabel} · ${groupLabel}`;
}

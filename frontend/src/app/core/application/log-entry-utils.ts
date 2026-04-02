// log-entry-utils.ts: Utilidades para gestión de entradas de log de jobs científicos.
// Proporciona funciones puras para deduplicar y ordenar entradas de log por eventIndex.

import type { JobLogEntryView } from '../api/jobs-api.service';

/**
 * Combina una entrada de log entrante con la lista actual evitando duplicados.
 * Deduplica por eventIndex y ordena ascendentemente por eventIndex.
 */
export function mergeLogEntry(
  current: JobLogEntryView[],
  incoming: JobLogEntryView,
): JobLogEntryView[] {
  if (current.some((item: JobLogEntryView) => item.eventIndex === incoming.eventIndex)) {
    return current;
  }
  return [...current, incoming].sort(
    (a: JobLogEntryView, b: JobLogEntryView) => a.eventIndex - b.eventIndex,
  );
}

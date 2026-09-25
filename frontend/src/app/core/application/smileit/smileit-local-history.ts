// smileit-local-history.ts: Historial de Smile-it en modo abierto desde los registros locales.
// El endpoint privado `GET /api/jobs/?plugin_name=smileit` exige sesión (401 para un invitado),
// así que el panel histórico se alimenta de `LocalResultsStore`. Para no duplicar el template de
// resultados, cada registro local se presenta como la vista de job que ya consume la tabla.

import { SmileitParameters, StatusEnum } from '../../api/generated';
import type { ScientificJobView } from '../../api/jobs-api.service';
import type { LocalResultRecord, LocalResultsStore } from '../../shared/local-results.store';

/** Plugin bajo el que Smile-it persiste sus registros locales. */
export const SMILEIT_PLUGIN_NAME = 'smileit';

/** Datos de la respuesta de Smile-it que el historial local necesita conservar. */
export interface SmileitLocalRecordInput {
  jobId: string;
  status: string;
  progressPercentage: number;
  parameters: SmileitParameters | null | undefined;
  resultSummary: unknown;
}

/** Crea o actualiza el registro local del job sin exponer el almacén a la fachada. */
export function saveSmileitLocalRecord(
  store: LocalResultsStore,
  input: SmileitLocalRecordInput,
): void {
  store.upsert({
    pluginName: SMILEIT_PLUGIN_NAME,
    jobId: input.jobId,
    status: input.status,
    progressPercentage: input.progressPercentage,
    parameters:
      input.parameters === null || input.parameters === undefined
        ? {}
        : { ...input.parameters },
    resultSummary: input.resultSummary,
  });
}

/** Estados conocidos del backend; cualquier otro valor se muestra como pendiente. */
function toBackendJobStatus(rawStatus: string): StatusEnum {
  const matchedStatus: StatusEnum | undefined = Object.values(StatusEnum).find(
    (knownStatus: StatusEnum) => knownStatus === rawStatus,
  );
  return matchedStatus ?? StatusEnum.Pending;
}

/**
 * Estado mostrable del registro local. Uno caducado ya no tiene resultado en el servidor,
 * así que se pinta como fallido en lugar de inventar un estado inexistente en la API.
 */
export function localRecordJobStatus(record: LocalResultRecord): StatusEnum {
  return record.expired ? StatusEnum.Failed : toBackendJobStatus(record.status);
}

/**
 * Vista de job construida desde un registro local. Los campos que el modo abierto no conoce
 * (dueño, hash de caché, marca de borrado) se completan con valores neutrales.
 */
export function mapLocalRecordToHistoryJob(record: LocalResultRecord): ScientificJobView {
  const jobStatus: StatusEnum = localRecordJobStatus(record);

  return {
    id: record.jobId,
    owner: null,
    group: null,
    job_hash: '',
    plugin_name: record.pluginName,
    algorithm_version: '',
    status: jobStatus,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    scheduled_hard_delete_at: null,
    cache_hit: false,
    cache_miss: false,
    progress_percentage: record.progressPercentage,
    progress_stage: jobStatus,
    progress_message: '',
    progress_event_index: 0,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: record.parameters,
    results: record.resultSummary,
    error_trace: '',
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

/**
 * Ordena y deduplica registros locales por `jobId`, conservando el snapshot más reciente.
 * `LocalResultsStore` ya devuelve la lista ordenada, pero el historial visible se reconstruye
 * a partir de una lectura defensiva del almacenamiento.
 */
export function mapLocalRecordsToHistoryJobs(
  records: LocalResultRecord[],
): ScientificJobView[] {
  const latestRecordByJobId: Map<string, LocalResultRecord> = new Map<string, LocalResultRecord>();

  records.forEach((record: LocalResultRecord) => {
    const previousRecord: LocalResultRecord | undefined = latestRecordByJobId.get(record.jobId);
    const isNewerSnapshot: boolean =
      previousRecord === undefined ||
      Date.parse(record.updatedAt) >= Date.parse(previousRecord.updatedAt);
    if (isNewerSnapshot) {
      latestRecordByJobId.set(record.jobId, record);
    }
  });

  return [...latestRecordByJobId.values()]
    .sort((leftRecord: LocalResultRecord, rightRecord: LocalResultRecord) =>
      Date.parse(rightRecord.updatedAt) - Date.parse(leftRecord.updatedAt),
    )
    .map(mapLocalRecordToHistoryJob);
}

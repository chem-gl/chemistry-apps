// generic-jobs.types.ts: Tipos genéricos compartidos para jobs científicos, logs y control de ejecución.
// Uso: importar desde este archivo cuando se necesite tipado de jobs, eventos de log o acciones de control.

import { JobProgressSnapshot, ScientificJob } from '../generated';

/** Estados válidos para filtrado de jobs en listados globales */
export type JobListStatusFilter =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Filtros opcionales para consultar jobs en el monitor */
export interface JobListFilters {
  pluginName?: string;
  status?: JobListStatusFilter;
}

/** Parámetros genéricos para despachar jobs de cualquier app científica */
export interface ScientificJobDispatchParams {
  pluginName: string;
  version?: string;
  parameters: Record<string, unknown>;
}

/** Severidad de eventos de log por job emitidos por backend */
export type JobLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Evento de log normalizado para consumo de componentes/facades */
export interface JobLogEntryView {
  jobId: string;
  eventIndex: number;
  level: JobLogLevel;
  source: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Parámetros de consulta para historial de logs por job */
export interface JobLogsQuery {
  afterEventIndex?: number;
  limit?: number;
}

/** Página de historial de logs normalizada */
export interface JobLogsPageView {
  jobId: string;
  count: number;
  nextAfterEventIndex: number;
  results: JobLogEntryView[];
}

/** Resultado normalizado de acciones de control de ejecución (pause/resume) */
export interface JobControlActionResult {
  detail: string;
  job: ScientificJob;
}

/** Representa un archivo descargable retornado por reportes backend */
export interface DownloadedReportFile {
  filename: string;
  blob: Blob;
}

// Re-exports de tipos generados para evitar dependencias directas al cliente OpenAPI autogenerado
export type ScientificJobView = ScientificJob;
export type JobProgressSnapshotView = JobProgressSnapshot;

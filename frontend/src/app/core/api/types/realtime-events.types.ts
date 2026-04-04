// realtime-events.types.ts: Tipos de eventos en tiempo real (WebSocket/SSE) para jobs científicos.
// Uso: importar cuando se necesite tipado de eventos de progreso, logs o snapshots en tiempo real.

import { JobProgressSnapshot, ScientificJob } from '../generated';

import { JobLogEntryView } from './generic-jobs.types';

export interface JobsRealtimeQuery {
  jobId?: string;
  pluginName?: string;
  includeLogs?: boolean;
  includeSnapshot?: boolean;
  activeOnly?: boolean;
}

export interface JobsSnapshotRealtimeEvent {
  event: 'jobs.snapshot';
  data: {
    items: ScientificJob[];
  };
}

export interface JobUpdatedRealtimeEvent {
  event: 'job.updated';
  data: ScientificJob;
}

export interface JobProgressRealtimeEvent {
  event: 'job.progress';
  data: JobProgressSnapshot;
}

export interface JobLogRealtimeEvent {
  event: 'job.log';
  data: JobLogEntryView;
}

export type JobsRealtimeEvent =
  | JobsSnapshotRealtimeEvent
  | JobUpdatedRealtimeEvent
  | JobProgressRealtimeEvent
  | JobLogRealtimeEvent;

// smileit-local-history.spec.ts: Mapeo de registros locales de Smile-it a la vista del historial.

import { describe, expect, it } from 'vitest';
import type { LocalResultRecord } from '../../shared/local-results.store';
import {
  localRecordJobStatus,
  mapLocalRecordToHistoryJob,
  mapLocalRecordsToHistoryJobs,
  SMILEIT_PLUGIN_NAME,
} from './smileit-local-history';

function makeRecord(overrides: Partial<LocalResultRecord> = {}): LocalResultRecord {
  return {
    jobId: 'job-1',
    pluginName: SMILEIT_PLUGIN_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    status: 'completed',
    progressPercentage: 100,
    parameters: { principal_smiles: 'c1ccccc1' },
    resultSummary: { totalGenerated: 2 },
    expired: false,
    ...overrides,
  };
}

describe('smileit-local-history', () => {
  it('traduce los estados del registro local al vocabulario del API', () => {
    expect(localRecordJobStatus(makeRecord({ status: 'running' }))).toBe('running');
    expect(localRecordJobStatus(makeRecord({ status: 'estado-nuevo' }))).toBe('pending');
    expect(localRecordJobStatus(makeRecord({ status: 'completed', expired: true }))).toBe('failed');
  });

  it('expone la vista que consume la tabla histórica de Smile-it', () => {
    const historyJob = mapLocalRecordToHistoryJob(makeRecord());

    expect(historyJob.id).toBe('job-1');
    expect(historyJob.plugin_name).toBe(SMILEIT_PLUGIN_NAME);
    expect(historyJob.status).toBe('completed');
    expect(historyJob.updated_at).toBe('2026-02-01T00:00:00.000Z');
    expect(historyJob.parameters['principal_smiles']).toBe('c1ccccc1');
    expect(historyJob.results).toEqual({ totalGenerated: 2 });
  });

  it('ordena por actualización descendente y deduplica conservando el snapshot más reciente', () => {
    const historyJobs = mapLocalRecordsToHistoryJobs([
      makeRecord({ jobId: 'old', updatedAt: '2026-01-05T00:00:00.000Z' }),
      makeRecord({ jobId: 'dup', updatedAt: '2026-01-01T00:00:00.000Z', status: 'running' }),
      makeRecord({ jobId: 'new', updatedAt: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ jobId: 'dup', updatedAt: '2026-02-15T00:00:00.000Z', status: 'completed' }),
    ]);

    expect(historyJobs.map((historyJob) => historyJob.id)).toEqual(['new', 'dup', 'old']);
    expect(historyJobs[1].status).toBe('completed');
  });
});

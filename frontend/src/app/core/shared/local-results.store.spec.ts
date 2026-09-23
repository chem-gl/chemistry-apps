import { describe, expect, it, beforeEach } from 'vitest';
import { LocalResultsStore, LocalResultRecord } from './local-results.store';

const record = (jobId: string, updatedAt = jobId): LocalResultRecord => ({
  jobId,
  pluginName: 'test',
  createdAt: updatedAt,
  updatedAt,
  status: 'completed',
  progressPercentage: 100,
  parameters: {},
  resultSummary: null,
  expired: false,
});

describe('LocalResultsStore', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('keeps the newest 20 records', () => {
    const store = new LocalResultsStore();
    for (let index = 0; index < 21; index += 1) {
      const timestamp = new Date(2026, 0, index + 1).toISOString();
      store.save(record(String(index).padStart(2, '0'), timestamp));
    }
    expect(store.list('test')).toHaveLength(20);
    expect(store.list('test').some((item) => item.jobId === '00')).toBe(false);
  });

  it('does not throw when storage quota is exceeded', () => {
    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(() => new LocalResultsStore().save(record('1'))).not.toThrow();
    globalThis.localStorage.setItem = original;
  });
});

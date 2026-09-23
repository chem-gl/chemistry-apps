import { Injectable } from '@angular/core';

export type LocalResultStatus = 'pending' | 'running' | 'completed' | 'failed' | 'expired' | string;

export interface LocalResultRecord {
  jobId: string;
  pluginName: string;
  createdAt: string;
  updatedAt: string;
  status: LocalResultStatus;
  progressPercentage: number;
  parameters: Record<string, unknown>;
  resultSummary: unknown;
  expired: boolean;
}

const MAX_RECORDS = 20;
const MAX_BYTES = 1_500_000;
const KEY_PREFIX = 'chemistry-apps.results.v1.';

@Injectable({ providedIn: 'root' })
export class LocalResultsStore {
  list(pluginName: string): LocalResultRecord[] {
    const storage = this.storage();
    if (storage === null) return [];
    try {
      const raw = storage.getItem(this.key(pluginName));
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(this.isRecord) : [];
    } catch {
      return [];
    }
  }

  save(record: LocalResultRecord): void {
    const storage = this.storage();
    if (storage === null) return;
    const records = [
      ...this.list(record.pluginName).filter((item) => item.jobId !== record.jobId),
      record,
    ]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_RECORDS);
    while (records.length > 0 && this.serializedSize(records) > MAX_BYTES) records.pop();
    try {
      storage.setItem(this.key(record.pluginName), JSON.stringify(records));
    } catch (error: unknown) {
      if (!this.isQuotaError(error)) return;
      while (records.length > 0) {
        records.pop();
        try {
          storage.setItem(this.key(record.pluginName), JSON.stringify(records));
          return;
        } catch (retryError: unknown) {
          if (!this.isQuotaError(retryError)) return;
        }
      }
    }
  }

  remove(pluginName: string, jobId: string): void {
    this.saveList(
      pluginName,
      this.list(pluginName).filter((record) => record.jobId !== jobId),
    );
  }

  clear(pluginName: string): void {
    const storage = this.storage();
    if (storage === null) return;
    try {
      storage.removeItem(this.key(pluginName));
    } catch {
      /* Persistencia opcional. */
    }
  }

  private saveList(pluginName: string, records: LocalResultRecord[]): void {
    const storage = this.storage();
    if (storage === null) return;
    try {
      storage.setItem(this.key(pluginName), JSON.stringify(records));
    } catch {
      /* Persistencia opcional. */
    }
  }

  private storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private key(pluginName: string): string {
    return `${KEY_PREFIX}${pluginName}`;
  }
  private serializedSize(records: LocalResultRecord[]): number {
    return JSON.stringify(records).length;
  }
  private isQuotaError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'QuotaExceededError';
  }
  private isRecord(value: unknown): value is LocalResultRecord {
    return value !== null && typeof value === 'object' && 'jobId' in value && 'pluginName' in value;
  }
}

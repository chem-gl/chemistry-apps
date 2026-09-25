import { Injectable } from '@angular/core';

export interface LocalResultRecord {
  jobId: string;
  pluginName: string;
  createdAt: string;
  updatedAt: string;
  // Estado conocido: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  // | 'cancelled' (backend) más 'expired' (marcado local). Se tipa como
  // `string` porque el backend puede ampliar el vocabulario sin que el
  // historial local deba cambiar.
  status: string;
  progressPercentage: number;
  parameters: Record<string, unknown>;
  resultSummary: unknown;
  expired: boolean;
}

/** Datos mínimos para crear o actualizar el registro local del job de una app. */
export interface LocalResultUpsert {
  pluginName: string;
  jobId: string;
  status: string;
  progressPercentage: number;
  parameters: Record<string, unknown>;
  resultSummary?: unknown;
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
    try {
      const storage = this.storage();
      if (storage === null) return;
      const records = this.pruneToFit(this.recordsWith(this.slimRecordIfHuge(record)));
      if (this.tryPersist(storage, record.pluginName, records) !== 'quota') return;
      this.persistCompact(storage, record);
    } catch {
      // La persistencia local es opcional y nunca bloquea el flujo.
    }
  }

  /** Si un registro solo ya supera el tope, guarda sin el resumen pesado. */
  private slimRecordIfHuge(record: LocalResultRecord): LocalResultRecord {
    if (this.serializedSize([record]) <= MAX_BYTES) return record;
    return { ...record, resultSummary: null };
  }

  /** Recorta por tamaño manteniendo los más recientes (ya ordenados). */
  private pruneToFit(records: LocalResultRecord[]): LocalResultRecord[] {
    const pruned = [...records];
    while (pruned.length > 0 && this.serializedSize(pruned) > MAX_BYTES) {
      pruned.pop();
    }
    return pruned;
  }

  /** Intenta persistir; ante cuota, reintenta con el registro compacto. */
  private persistCompact(storage: Storage, record: LocalResultRecord): void {
    const compactRecords = this.pruneToFit(
      this.recordsWith({ ...record, resultSummary: null }),
    );
    if (this.tryPersist(storage, record.pluginName, compactRecords) !== 'quota') return;
    this.persistOneByOne(storage, record.pluginName, compactRecords);
  }

  /** Persiste quitando de uno en uno hasta caber o vaciar la lista. */
  private persistOneByOne(
    storage: Storage,
    pluginName: string,
    records: LocalResultRecord[],
  ): void {
    const remaining = [...records];
    while (remaining.length > 0) {
      remaining.pop();
      try {
        storage.setItem(this.key(pluginName), JSON.stringify(remaining));
        return;
      } catch (persistError: unknown) {
        if (!this.isQuotaError(persistError)) return;
      }
    }
  }

  private tryPersist(
    storage: Storage,
    pluginName: string,
    records: LocalResultRecord[],
  ): 'ok' | 'quota' | 'fatal' {
    try {
      storage.setItem(this.key(pluginName), JSON.stringify(records));
      return 'ok';
    } catch (persistError: unknown) {
      return this.isQuotaError(persistError) ? 'quota' : 'fatal';
    }
  }

  private recordsWith(record: LocalResultRecord): LocalResultRecord[] {
    return [
      ...this.list(record.pluginName).filter((item) => item.jobId !== record.jobId),
      record,
    ]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_RECORDS);
  }

  /**
   * Crea o actualiza el registro de un job y devuelve el listado completo y ordenado.
   * Conserva `createdAt` del registro previo y su `resultSummary` cuando el aporte nuevo
   * llega sin resumen (por ejemplo en los avances parciales de progreso).
   */
  upsert(input: LocalResultUpsert): LocalResultRecord[] {
    const previousRecord: LocalResultRecord | undefined = this.list(input.pluginName).find(
      (record: LocalResultRecord) => record.jobId === input.jobId,
    );
    const timestamp: string = new Date().toISOString();

    this.save({
      jobId: input.jobId,
      pluginName: input.pluginName,
      createdAt: previousRecord?.createdAt ?? timestamp,
      updatedAt: timestamp,
      status: input.status,
      progressPercentage: input.progressPercentage,
      parameters: input.parameters,
      resultSummary: input.resultSummary ?? previousRecord?.resultSummary ?? null,
      expired: false,
    });

    return this.list(input.pluginName);
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
    if (!(error instanceof DOMException)) return false;
    // Nombres históricos sin usar el obsoleto `DOMException.code`: Chrome y
    // Safari modernos usan 'QuotaExceededError'; Firefox antiguo,
    // 'NS_ERROR_DOM_QUOTA_REACHED'.
    return error.name === 'QuotaExceededError' || error.name.includes('QUOTA');
  }

  private isRecord(value: unknown): value is LocalResultRecord {
    return (
      value !== null && typeof value === 'object' && 'jobId' in value && 'pluginName' in value
    );
  }
}

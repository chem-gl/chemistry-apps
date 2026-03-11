// random-numbers.component.ts: Pantalla para generar números aleatorios con progreso en tiempo real.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScientificJob } from '../core/api/generated';
import { JobLogEntryView } from '../core/api/jobs-api.service';
import { RandomNumbersWorkflowService } from '../core/application/random-numbers-workflow.service';

@Component({
  selector: 'app-random-numbers',
  imports: [CommonModule, FormsModule],
  providers: [RandomNumbersWorkflowService],
  template: `
    <section class="random-shell" aria-label="Generador de números aleatorios">
      <header>
        <p class="eyebrow">Random Numbers</p>
        <h2>Generación Asíncrona con Semilla URL</h2>
        <p>Configura cuántos números generar por lote, cada cuántos segundos y cuántos totales.</p>
      </header>

      <section class="form-card" aria-label="Parámetros de generación">
        <div class="grid">
          <label>
            URL semilla
            <input
              type="url"
              [ngModel]="workflow.seedUrl()"
              (ngModelChange)="workflow.seedUrl.set($event)"
              [disabled]="workflow.isProcessing()"
              placeholder="https://example.com/seed.txt"
            />
          </label>

          <label>
            Números por lote
            <input
              type="number"
              min="1"
              [ngModel]="workflow.numbersPerBatch()"
              (ngModelChange)="workflow.numbersPerBatch.set($event)"
              [disabled]="workflow.isProcessing()"
            />
          </label>

          <label>
            Intervalo por lote (segundos)
            <input
              type="number"
              min="1"
              [ngModel]="workflow.intervalSeconds()"
              (ngModelChange)="workflow.intervalSeconds.set($event)"
              [disabled]="workflow.isProcessing()"
            />
          </label>

          <label>
            Total de números
            <input
              type="number"
              min="1"
              [ngModel]="workflow.totalNumbers()"
              (ngModelChange)="workflow.totalNumbers.set($event)"
              [disabled]="workflow.isProcessing()"
            />
          </label>
        </div>

        <div class="actions">
          <button class="btn-primary" (click)="dispatch()" [disabled]="workflow.isProcessing()">
            {{ workflow.isProcessing() ? 'Procesando...' : 'Generar' }}
          </button>
          <button class="btn-secondary" (click)="reset()" [disabled]="workflow.isProcessing()">
            Limpiar
          </button>
        </div>
      </section>

      @if (workflow.activeSection() === 'progress') {
        <section class="status-card" aria-live="polite">
          <h3>Job en progreso</h3>
          <p class="job-id">{{ workflow.currentJobId() }}</p>

          <div
            class="progress-track"
            role="progressbar"
            [attr.aria-valuenow]="workflow.progressPercentage()"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="progress-fill" [style.width.%]="workflow.progressPercentage()"></div>
          </div>

          <p class="progress-pct">{{ workflow.progressPercentage() }}%</p>
          <p class="progress-stage">Etapa: {{ workflow.progressSnapshot()?.progress_stage }}</p>
          <p class="progress-message">{{ workflow.progressMessage() }}</p>
        </section>
      }

      @if (workflow.jobLogs().length > 0) {
        <section class="logs-card" aria-label="Logs de ejecución random numbers">
          <h3>Logs de ejecución</h3>
          <div class="logs-list">
            @for (logEntry of workflow.jobLogs(); track logEntry.eventIndex) {
              <article class="log-item">
                <header class="log-header">
                  <span class="log-level" [class]="logLevelClass(logEntry.level)">
                    {{ logEntry.level }}
                  </span>
                  <span class="log-source">{{ logEntry.source }}</span>
                  <span class="log-index">#{{ logEntry.eventIndex }}</span>
                </header>
                <p class="log-message">{{ logEntry.message }}</p>
                @if (hasPayload(logEntry)) {
                  <pre class="log-payload">{{ logEntry.payload | json }}</pre>
                }
              </article>
            }
          </div>
        </section>
      }

      @if (workflow.activeSection() === 'result' && workflow.resultData(); as resultData) {
        <section class="result-card" aria-label="Resultado random numbers">
          <h3>Resultado generado</h3>

          <div class="meta-grid">
            <p><strong>URL semilla:</strong> {{ resultData.seedUrl }}</p>
            <p>
              <strong>Digest:</strong> <span class="mono">{{ resultData.seedDigest }}</span>
            </p>
            <p><strong>Lote:</strong> {{ resultData.numbersPerBatch }}</p>
            <p><strong>Intervalo:</strong> {{ resultData.intervalSeconds }}s</p>
            <p><strong>Total:</strong> {{ resultData.totalNumbers }}</p>
          </div>

          <h4>Números aleatorios</h4>
          <div class="numbers-grid">
            @for (randomNumber of resultData.generatedNumbers; track $index) {
              <span class="number-chip">{{ randomNumber }}</span>
            }
          </div>
        </section>
      }

      @if (workflow.activeSection() === 'error' && workflow.errorMessage(); as currentError) {
        <section class="error-card" role="alert">
          {{ currentError }}
        </section>
      }

      <section class="history-card" aria-label="Historial de jobs random numbers">
        <div class="history-header">
          <h3>Historial de resultados</h3>
          <button
            class="btn-secondary"
            (click)="workflow.loadHistory()"
            [disabled]="workflow.isHistoryLoading()"
          >
            {{ workflow.isHistoryLoading() ? 'Cargando...' : 'Recargar historial' }}
          </button>
        </div>

        @if (workflow.historyJobs().length === 0) {
          <p class="history-empty">Aún no hay jobs históricos para random numbers.</p>
        } @else {
          <div class="history-table-wrap">
            <table class="history-table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Estado</th>
                  <th>Números</th>
                  <th>Actualizado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                @for (historyJob of workflow.historyJobs(); track historyJob.id) {
                  <tr>
                    <td class="mono">{{ historyJob.id }}</td>
                    <td>
                      <span [class]="historicalStatusClass(historyJob.status)">
                        {{ historyJob.status }}
                      </span>
                    </td>
                    <td>{{ historicalNumbersCount(historyJob) }}</td>
                    <td>{{ historyJob.updated_at | date: 'dd/MM HH:mm:ss' }}</td>
                    <td>
                      <button class="history-open-btn" (click)="openHistoricalJob(historyJob.id)">
                        Abrir resultado
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </section>
  `,
  styles: `
    .random-shell {
      display: grid;
      gap: 1rem;
    }

    header h2 {
      margin: 0.2rem 0;
      color: #2d1b63;
    }

    .eyebrow {
      margin: 0;
      color: #5b21b6;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
      font-weight: 700;
    }

    header p {
      margin: 0;
      color: #5d4b8a;
    }

    .form-card,
    .status-card,
    .result-card,
    .error-card {
      border: 1px solid #ddd6fe;
      border-radius: 14px;
      background: #fdfbff;
      padding: 1rem;
    }

    .grid {
      display: grid;
      gap: 0.7rem;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    }

    label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.84rem;
      font-weight: 700;
      color: #4c1d95;
    }

    input {
      border: 1px solid #c4b5fd;
      border-radius: 9px;
      padding: 0.48rem 0.62rem;
      font-size: 0.95rem;
      background: #fff;
    }

    .actions {
      margin-top: 0.85rem;
      display: flex;
      gap: 0.55rem;
      flex-wrap: wrap;
    }

    .btn-primary,
    .btn-secondary {
      border: 1px solid #5b21b6;
      border-radius: 999px;
      padding: 0.45rem 0.85rem;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-primary {
      color: #fff;
      background: #6d28d9;
    }

    .btn-secondary {
      color: #5b21b6;
      background: #fff;
    }

    .job-id,
    .mono {
      font-family: 'Consolas', 'Liberation Mono', monospace;
      word-break: break-all;
      font-size: 0.8rem;
      color: #3b2073;
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      background: #e9e3ff;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #8b5cf6, #6d28d9);
      transition: width 0.3s ease;
    }

    .progress-pct {
      margin: 0.4rem 0;
      font-weight: 700;
      color: #4c1d95;
    }

    .progress-message {
      margin: 0;
      color: #5d4b8a;
    }

    .progress-stage {
      margin: 0.2rem 0;
      color: #4c1d95;
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .logs-card {
      border: 1px solid #ddd6fe;
      border-radius: 14px;
      background: #fff;
      padding: 1rem;
      display: grid;
      gap: 0.65rem;
    }

    .logs-card h3 {
      margin: 0;
      color: #3b2073;
      font-size: 1rem;
    }

    .logs-list {
      display: grid;
      gap: 0.5rem;
      max-height: 300px;
      overflow: auto;
      padding-right: 0.2rem;
    }

    .log-item {
      border: 1px solid #e3ddff;
      border-radius: 9px;
      background: #fcfbff;
      padding: 0.5rem 0.6rem;
      display: grid;
      gap: 0.3rem;
    }

    .log-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      font-size: 0.72rem;
    }

    .log-level {
      border-radius: 999px;
      border: 1px solid transparent;
      padding: 0.08rem 0.42rem;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 0.04em;
    }

    .log-level-debug {
      color: #374151;
      background: #f3f4f6;
      border-color: #e5e7eb;
    }

    .log-level-info {
      color: #4c1d95;
      background: #ede9fe;
      border-color: #c4b5fd;
    }

    .log-level-warning {
      color: #854d0e;
      background: #fef9c3;
      border-color: #fde68a;
    }

    .log-level-error {
      color: #991b1b;
      background: #fee2e2;
      border-color: #fecaca;
    }

    .log-source,
    .log-index {
      color: #6b7280;
      font-family: 'Consolas', 'Liberation Mono', monospace;
      font-size: 0.72rem;
    }

    .log-message {
      margin: 0;
      color: #3b2073;
      font-size: 0.82rem;
    }

    .log-payload {
      margin: 0;
      font-size: 0.72rem;
      font-family: 'Consolas', 'Liberation Mono', monospace;
      background: #fff;
      border: 1px solid #ede9fe;
      border-radius: 7px;
      padding: 0.4rem;
      color: #4c1d95;
      overflow: auto;
    }

    .meta-grid {
      display: grid;
      gap: 0.35rem;
      margin-bottom: 0.7rem;
    }

    .meta-grid p {
      margin: 0;
      color: #49337a;
      font-size: 0.88rem;
    }

    h4 {
      margin: 0.2rem 0 0.5rem;
      color: #3b2073;
      font-size: 0.95rem;
    }

    .numbers-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    .number-chip {
      border: 1px solid #c4b5fd;
      background: #fff;
      color: #4c1d95;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      font-size: 0.84rem;
      font-weight: 700;
    }

    .error-card {
      border-color: #fbcfe8;
      color: #9d174d;
      background: #fff1f7;
      font-weight: 700;
    }

    .history-card {
      border: 1px solid #ddd6fe;
      border-radius: 14px;
      background: #fff;
      padding: 1rem;
      display: grid;
      gap: 0.75rem;
    }

    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .history-header h3 {
      margin: 0;
      color: #3b2073;
      font-size: 1rem;
    }

    .history-empty {
      margin: 0;
      color: #5d4b8a;
      font-size: 0.88rem;
    }

    .history-table-wrap {
      overflow: auto;
      border: 1px solid #e3ddff;
      border-radius: 10px;
    }

    .history-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 700px;
    }

    .history-table th,
    .history-table td {
      text-align: left;
      padding: 0.55rem;
      border-bottom: 1px solid #f0ebff;
      font-size: 0.82rem;
    }

    .history-table th {
      color: #4c1d95;
      background: #faf8ff;
      font-weight: 700;
    }

    .history-status {
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 0.15rem 0.45rem;
      text-transform: uppercase;
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.03em;
    }

    .history-completed {
      color: #166534;
      background: #dcfce7;
      border-color: #86efac;
    }

    .history-failed {
      color: #991b1b;
      background: #fee2e2;
      border-color: #fecaca;
    }

    .history-running {
      color: #1d4ed8;
      background: #dbeafe;
      border-color: #93c5fd;
    }

    .history-pending {
      color: #854d0e;
      background: #fef9c3;
      border-color: #fde68a;
    }

    .history-open-btn {
      border: 1px solid #5b21b6;
      background: #fff;
      color: #5b21b6;
      border-radius: 999px;
      padding: 0.28rem 0.58rem;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
  `,
})
export class RandomNumbersComponent implements OnInit, OnDestroy {
  readonly workflow = inject(RandomNumbersWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  ngOnInit(): void {
    this.workflow.loadHistory();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  historicalStatusClass(jobStatus: ScientificJob['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalNumbersCount(job: ScientificJob): number {
    const rawResults: unknown = job.results;
    if (rawResults === null || typeof rawResults !== 'object' || Array.isArray(rawResults)) {
      return 0;
    }

    const resultsRecord: { generated_numbers?: unknown } = rawResults as {
      generated_numbers?: unknown;
    };
    const rawGeneratedNumbers: unknown = resultsRecord.generated_numbers;
    return Array.isArray(rawGeneratedNumbers) ? rawGeneratedNumbers.length : 0;
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }
}

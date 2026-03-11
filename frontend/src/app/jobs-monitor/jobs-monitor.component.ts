// jobs-monitor.component.ts: Vista para monitorear jobs activos y terminados con filtros.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScientificJob } from '../core/api/generated';
import { JobLogEntryView } from '../core/api/jobs-api.service';
import {
  JobStatusFilterOption,
  JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';

@Component({
  selector: 'app-jobs-monitor',
  imports: [CommonModule, FormsModule, RouterLink],
  providers: [JobsMonitorFacadeService],
  template: `
    <section class="monitor-shell" aria-label="Monitor de jobs">
      <header class="monitor-header">
        <div>
          <p class="eyebrow">Operaciones distribuidas</p>
          <h1>Monitor de Jobs</h1>
          <p class="subtitle">
            Supervisa trabajos en curso, terminados y fallidos en todas las apps.
          </p>
        </div>

        <div class="header-actions">
          <button class="btn btn-ghost" (click)="refreshNow()">Actualizar</button>
          <button
            class="btn"
            [class.btn-on]="facade.autoRefreshEnabled()"
            (click)="toggleAutoRefresh()"
          >
            Auto-refresh: {{ facade.autoRefreshEnabled() ? 'ON' : 'OFF' }}
          </button>
        </div>
      </header>

      <section class="kpi-grid" aria-label="Resumen de estados">
        <article class="kpi-card">
          <p class="kpi-label">Activos</p>
          <p class="kpi-value">{{ facade.activeJobs().length }}</p>
        </article>

        <article class="kpi-card">
          <p class="kpi-label">Terminados</p>
          <p class="kpi-value">{{ facade.finishedJobs().length }}</p>
        </article>

        <article class="kpi-card">
          <p class="kpi-label">Fallidos</p>
          <p class="kpi-value">{{ facade.failedJobs().length }}</p>
        </article>

        <article class="kpi-card kpi-time">
          <p class="kpi-label">Ultima actualizacion</p>
          <p class="kpi-time-value">
            {{ facade.lastUpdatedAt() ? (facade.lastUpdatedAt() | date: 'HH:mm:ss') : '--:--:--' }}
          </p>
        </article>
      </section>

      <section class="filters" aria-label="Filtros del monitor">
        <label>
          Estado
          <select
            [ngModel]="facade.selectedStatus()"
            (ngModelChange)="onStatusFilterChanged($event)"
          >
            @for (statusOption of statusOptions; track statusOption.value) {
              <option [value]="statusOption.value">{{ statusOption.label }}</option>
            }
          </select>
        </label>

        <label>
          App
          <select
            [ngModel]="facade.selectedPluginName()"
            (ngModelChange)="onPluginFilterChanged($event)"
          >
            @for (pluginOption of facade.pluginOptions(); track pluginOption) {
              <option [value]="pluginOption">
                {{ pluginOption === 'all' ? 'Todas' : pluginOption }}
              </option>
            }
          </select>
        </label>
      </section>

      @if (facade.isLoading()) {
        <section class="state state-loading" aria-live="polite">Cargando jobs...</section>
      }

      @if (facade.errorMessage(); as currentError) {
        <section class="state state-error" role="alert">
          {{ currentError }}
        </section>
      }

      <section class="jobs-section" aria-label="Jobs activos">
        <h2>En ejecucion</h2>
        @if (facade.activeJobs().length === 0) {
          <p class="empty-state">No hay jobs activos para los filtros actuales.</p>
        } @else {
          <div class="jobs-grid">
            @for (activeJob of facade.activeJobs(); track activeJob.id) {
              <article class="job-card">
                <header class="job-card-header">
                  <span class="job-plugin">{{ activeJob.plugin_name }}</span>
                  <span class="job-status" [class]="statusClassName(activeJob.status)">
                    {{ activeJob.status }}
                  </span>
                </header>

                <p class="job-id">{{ activeJob.id }}</p>

                <div
                  class="progress-track"
                  role="progressbar"
                  [attr.aria-valuenow]="activeJob.progress_percentage"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div class="progress-fill" [style.width.%]="activeJob.progress_percentage"></div>
                </div>

                <div class="job-meta">
                  <span>{{ activeJob.progress_percentage }}%</span>
                  <span class="stage-pill" [class]="stageClassName(activeJob.progress_stage)">
                    {{ activeJob.progress_stage }}
                  </span>
                </div>

                <p class="job-message">{{ activeJob.progress_message }}</p>

                <div class="actions-cell">
                  <button class="open-logs-btn" (click)="openJobDetails(activeJob.id)">
                    Ver logs en vivo
                  </button>
                </div>
              </article>
            }
          </div>
        }
      </section>

      <section class="jobs-section" aria-label="Jobs terminados">
        <h2>Terminados y fallidos</h2>
        @if (facade.finishedJobs().length === 0) {
          <p class="empty-state">Aun no hay jobs terminados en este filtro.</p>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>App</th>
                  <th>Estado</th>
                  <th>Progreso</th>
                  <th>Etapa</th>
                  <th>Cache</th>
                  <th>Actualizado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                @for (finishedJob of facade.finishedJobs(); track finishedJob.id) {
                  <tr>
                    <td class="mono">{{ finishedJob.id }}</td>
                    <td>{{ finishedJob.plugin_name }}</td>
                    <td>
                      <span class="job-status" [class]="statusClassName(finishedJob.status)">
                        {{ finishedJob.status }}
                      </span>
                    </td>
                    <td>{{ finishedJob.progress_percentage }}%</td>
                    <td>
                      <span class="stage-pill" [class]="stageClassName(finishedJob.progress_stage)">
                        {{ finishedJob.progress_stage }}
                      </span>
                    </td>
                    <td>{{ finishedJob.cache_hit ? 'Hit' : 'Miss' }}</td>
                    <td>{{ finishedJob.updated_at | date: 'dd/MM HH:mm:ss' }}</td>
                    <td>
                      <div class="actions-cell">
                        <button class="open-logs-btn" (click)="openJobDetails(finishedJob.id)">
                          Ver logs
                        </button>

                        @if (appRouteForJob(finishedJob); as appRoutePath) {
                          <a
                            class="open-result-link"
                            [routerLink]="appRoutePath"
                            [queryParams]="{ jobId: finishedJob.id }"
                          >
                            Abrir resultado
                          </a>
                        } @else {
                          <span class="open-result-disabled">Sin visor</span>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      @if (facade.selectedJobId() !== null) {
        <section class="details-overlay" aria-label="Detalle de job" (click)="closeJobDetails()">
          <article class="details-modal" (click)="$event.stopPropagation()">
            <header class="details-header">
              <h3>Detalle de job</h3>
              <button class="close-details-btn" (click)="closeJobDetails()">Cerrar</button>
            </header>

            @if (facade.isDetailsLoading()) {
              <p class="details-loading">Cargando detalle y logs...</p>
            } @else {
              @if (facade.detailsErrorMessage(); as detailsError) {
                <p class="details-error">{{ detailsError }}</p>
              }

              @if (facade.selectedJob(); as selectedJob) {
                <div class="details-meta-grid">
                  <p>
                    <strong>ID:</strong> <span class="mono">{{ selectedJob.id }}</span>
                  </p>
                  <p><strong>App:</strong> {{ selectedJob.plugin_name }}</p>
                  <p><strong>Estado:</strong> {{ selectedJob.status }}</p>
                  <p><strong>Etapa:</strong> {{ selectedJob.progress_stage }}</p>
                  <p><strong>Progreso:</strong> {{ selectedJob.progress_percentage }}%</p>
                  <p><strong>Mensaje:</strong> {{ selectedJob.progress_message }}</p>
                  <p>
                    <strong>Actualizado:</strong>
                    {{ selectedJob.updated_at | date: 'dd/MM HH:mm:ss' }}
                  </p>
                </div>

                @if (selectedJob.error_trace !== null && selectedJob.error_trace !== '') {
                  <section class="error-trace-box" aria-label="Error trace del job">
                    <h4>Error trace</h4>
                    <pre>{{ selectedJob.error_trace }}</pre>
                  </section>
                }
              }

              <section class="logs-box" aria-label="Logs del job">
                <h4>Logs</h4>
                @if (facade.selectedJobLogs().length === 0) {
                  <p class="details-empty">No hay logs disponibles para este job.</p>
                } @else {
                  <div class="logs-list">
                    @for (logEntry of facade.selectedJobLogs(); track logEntry.eventIndex) {
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
                }
              </section>
            }
          </article>
        </section>
      }
    </section>
  `,
  styles: `
    .monitor-shell {
      display: grid;
      gap: 1.25rem;
    }

    .monitor-header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .eyebrow {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
      color: #0f766e;
      font-weight: 700;
    }

    h1 {
      margin: 0.2rem 0;
      font-size: clamp(1.3rem, 2.6vw, 1.9rem);
      color: #073b3a;
    }

    .subtitle {
      margin: 0;
      color: #315b5a;
    }

    .header-actions {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .btn {
      border: 1px solid #0f766e;
      color: #0f766e;
      background: #d9fbf3;
      padding: 0.5rem 0.8rem;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-ghost {
      background: #fff;
    }

    .btn-on {
      background: #0f766e;
      color: #fff;
    }

    .kpi-grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    .kpi-card {
      border: 1px solid #8edbd0;
      background: linear-gradient(180deg, #effefb, #d8fbf4);
      border-radius: 12px;
      padding: 0.8rem;
    }

    .kpi-label {
      margin: 0;
      font-size: 0.8rem;
      color: #0f766e;
      font-weight: 600;
    }

    .kpi-value {
      margin: 0.2rem 0 0;
      font-size: 1.8rem;
      font-weight: 800;
      color: #052f2d;
    }

    .kpi-time-value {
      margin: 0.2rem 0 0;
      font-family: 'IBM Plex Mono', 'Fira Mono', monospace;
      font-weight: 700;
      color: #052f2d;
    }

    .filters {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      border: 1px solid #d8f1ee;
      border-radius: 12px;
      padding: 0.8rem;
      background: #fff;
    }

    label {
      display: grid;
      gap: 0.35rem;
      color: #2a4d4c;
      font-weight: 700;
      font-size: 0.85rem;
    }

    select {
      min-width: 170px;
      border: 1px solid #b4d9d4;
      border-radius: 8px;
      padding: 0.45rem 0.6rem;
      background: #fff;
    }

    .state {
      padding: 0.75rem;
      border-radius: 10px;
      font-weight: 600;
    }

    .state-loading {
      background: #f0f9ff;
      color: #075985;
      border: 1px solid #bae6fd;
    }

    .state-error {
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #fecdd3;
    }

    .jobs-section h2 {
      margin: 0 0 0.75rem;
      color: #073b3a;
      font-size: 1rem;
    }

    .empty-state {
      margin: 0;
      padding: 0.85rem;
      border: 1px dashed #9ecfca;
      border-radius: 10px;
      color: #436a69;
      background: #fbfffe;
    }

    .jobs-grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }

    .job-card {
      border: 1px solid #caece8;
      border-radius: 12px;
      background: #fff;
      padding: 0.8rem;
      display: grid;
      gap: 0.6rem;
    }

    .job-card-header {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      align-items: center;
    }

    .job-plugin {
      font-weight: 700;
      color: #134e4a;
      text-transform: lowercase;
    }

    .job-status {
      padding: 0.2rem 0.45rem;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border: 1px solid transparent;
    }

    .status-pending {
      background: #fef9c3;
      color: #854d0e;
      border-color: #fde68a;
    }

    .status-running {
      background: #dbeafe;
      color: #1d4ed8;
      border-color: #93c5fd;
    }

    .status-completed {
      background: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }

    .status-failed {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fecaca;
    }

    .job-id,
    .mono {
      margin: 0;
      font-family: 'IBM Plex Mono', 'Fira Mono', monospace;
      font-size: 0.73rem;
      color: #2f4f4d;
      word-break: break-all;
    }

    .progress-track {
      height: 8px;
      border-radius: 999px;
      background: #d8f6f1;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #14b8a6, #0f766e);
      transition: width 0.3s ease;
    }

    .job-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: #23615f;
      font-weight: 600;
    }

    .job-message {
      margin: 0;
      font-size: 0.84rem;
      color: #315b5a;
    }

    .stage-pill {
      border-radius: 999px;
      border: 1px solid transparent;
      padding: 0.1rem 0.45rem;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: #f1f5f9;
      color: #334155;
      border-color: #dbe4ee;
    }

    .stage-pending,
    .stage-queued {
      background: #fef9c3;
      color: #854d0e;
      border-color: #fde68a;
    }

    .stage-running {
      background: #dbeafe;
      color: #1d4ed8;
      border-color: #93c5fd;
    }

    .stage-recovering {
      background: #ede9fe;
      color: #5b21b6;
      border-color: #c4b5fd;
    }

    .stage-caching {
      background: #cffafe;
      color: #155e75;
      border-color: #67e8f9;
    }

    .stage-completed {
      background: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }

    .stage-failed {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fecaca;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid #cfe6e2;
      border-radius: 12px;
      background: #fff;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 640px;
    }

    th,
    td {
      text-align: left;
      padding: 0.62rem;
      border-bottom: 1px solid #ebf5f3;
      font-size: 0.84rem;
    }

    th {
      background: #f5fcfa;
      color: #245a56;
      font-weight: 700;
    }

    .open-result-link {
      display: inline-flex;
      text-decoration: none;
      border: 1px solid #0f766e;
      border-radius: 999px;
      padding: 0.2rem 0.5rem;
      color: #0f766e;
      background: #effefb;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .open-result-disabled {
      font-size: 0.75rem;
      color: #6b7280;
      font-weight: 600;
    }

    .actions-cell {
      display: flex;
      gap: 0.4rem;
      align-items: center;
      flex-wrap: wrap;
    }

    .open-logs-btn {
      border: 1px solid #0f766e;
      border-radius: 999px;
      padding: 0.2rem 0.5rem;
      color: #0f766e;
      background: #fff;
      font-size: 0.76rem;
      font-weight: 700;
      cursor: pointer;
    }

    .details-overlay {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.5);
      display: grid;
      place-items: center;
      padding: 1rem;
      z-index: 80;
    }

    .details-modal {
      width: min(900px, 100%);
      max-height: calc(100vh - 2rem);
      overflow: auto;
      border-radius: 12px;
      border: 1px solid #d8e7e3;
      background: #fff;
      padding: 1rem;
      display: grid;
      gap: 0.9rem;
    }

    .details-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .details-header h3 {
      margin: 0;
      color: #073b3a;
      font-size: 1rem;
    }

    .close-details-btn {
      border: 1px solid #0f766e;
      border-radius: 999px;
      background: #fff;
      color: #0f766e;
      padding: 0.25rem 0.65rem;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .details-loading {
      margin: 0;
      color: #1d4ed8;
      font-weight: 700;
    }

    .details-error {
      margin: 0;
      color: #9f1239;
      background: #fff1f2;
      border: 1px solid #fecdd3;
      border-radius: 10px;
      padding: 0.55rem;
      font-weight: 700;
    }

    .details-meta-grid {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .details-meta-grid p {
      margin: 0;
      font-size: 0.84rem;
      color: #285b57;
    }

    .error-trace-box {
      border: 1px solid #fecaca;
      border-radius: 10px;
      background: #fff5f5;
      padding: 0.7rem;
      display: grid;
      gap: 0.45rem;
    }

    .error-trace-box h4,
    .logs-box h4 {
      margin: 0;
      color: #7f1d1d;
      font-size: 0.92rem;
    }

    .error-trace-box pre {
      margin: 0;
      font-size: 0.73rem;
      background: #fff;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 0.5rem;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .logs-box {
      display: grid;
      gap: 0.45rem;
    }

    .details-empty {
      margin: 0;
      color: #4b5563;
      font-size: 0.83rem;
    }

    .logs-list {
      display: grid;
      gap: 0.55rem;
      max-height: 320px;
      overflow: auto;
      padding-right: 0.2rem;
    }

    .log-item {
      border: 1px solid #d4e5e2;
      border-radius: 9px;
      padding: 0.55rem;
      background: #f8fffd;
      display: grid;
      gap: 0.28rem;
    }

    .log-header {
      display: flex;
      align-items: center;
      gap: 0.45rem;
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
      color: #1d4ed8;
      background: #dbeafe;
      border-color: #93c5fd;
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
      color: #475569;
      font-family: 'IBM Plex Mono', 'Fira Mono', monospace;
      font-size: 0.72rem;
    }

    .log-message {
      margin: 0;
      font-size: 0.82rem;
      color: #1f2937;
    }

    .log-payload {
      margin: 0;
      font-size: 0.72rem;
      font-family: 'IBM Plex Mono', 'Fira Mono', monospace;
      background: #fff;
      border: 1px solid #dbe5f1;
      border-radius: 8px;
      padding: 0.45rem;
      color: #334155;
      overflow: auto;
    }
  `,
})
export class JobsMonitorComponent implements OnInit, OnDestroy {
  readonly facade = inject(JobsMonitorFacadeService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'pending', label: 'Pending' },
    { value: 'running', label: 'Running' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
  ];

  ngOnInit(): void {
    this.facade.loadJobs();
    this.facade.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.facade.stopAutoRefresh();
  }

  refreshNow(): void {
    this.facade.loadJobs();
  }

  toggleAutoRefresh(): void {
    this.facade.toggleAutoRefresh();
  }

  onStatusFilterChanged(nextStatus: JobStatusFilterOption): void {
    this.facade.setStatusFilter(nextStatus);
  }

  onPluginFilterChanged(nextPluginName: string): void {
    this.facade.setPluginFilter(nextPluginName);
  }

  openJobDetails(jobId: string): void {
    this.facade.openJobDetails(jobId);
  }

  closeJobDetails(): void {
    this.facade.closeJobDetails();
  }

  statusClassName(jobStatus: ScientificJob['status']): string {
    return `job-status status-${jobStatus}`;
  }

  stageClassName(progressStage: string): string {
    return `stage-pill stage-${progressStage}`;
  }

  appRouteForJob(jobItem: ScientificJob): string | null {
    if (jobItem.plugin_name === 'random-numbers') {
      return '/random-numbers';
    }

    if (jobItem.plugin_name === 'calculator') {
      return '/calculator';
    }

    return null;
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }
}

// jobs-monitor.component.ts: Vista para monitorear jobs activos y terminados con filtros.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScientificJob } from '../core/api/generated';
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
                  <span>{{ activeJob.progress_stage }}</span>
                </div>

                <p class="job-message">{{ activeJob.progress_message }}</p>
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
                    <td>{{ finishedJob.cache_hit ? 'Hit' : 'Miss' }}</td>
                    <td>{{ finishedJob.updated_at | date: 'dd/MM HH:mm:ss' }}</td>
                    <td>
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

  statusClassName(jobStatus: ScientificJob['status']): string {
    return `job-status status-${jobStatus}`;
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
}

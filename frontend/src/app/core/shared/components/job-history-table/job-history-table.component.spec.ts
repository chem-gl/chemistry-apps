// job-history-table.component.spec.ts: Pruebas de la tabla reutilizable de historial.
// Cubre: chips de estado (base status-chip + modificador, incluida la rama
// expired), modo autenticado (jobs), canDeleteJob y emisión de acciones sin
// selectores por índice posicional.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';
import { ScientificJobView } from '../../../api/jobs-api.service';
import { JobAccessModeService } from '../../../auth/job-access-mode.service';
import { LocalResultRecord } from '../../local-results.store';
import { JobHistoryTableComponent } from './job-history-table.component';

function record(jobId: string, status: string, expired = false): LocalResultRecord {
  return {
    jobId,
    pluginName: 'molar-fractions',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status,
    progressPercentage: 100,
    parameters: {},
    resultSummary: { value: jobId },
    expired,
  };
}

const buildJob = (overrides: Partial<ScientificJobView> = {}): ScientificJobView => ({
  id: 'job-1',
  owner: null,
  owner_username: null,
  group: null,
  group_name: null,
  job_hash: 'hash-1',
  plugin_name: 'molar-fractions',
  algorithm_version: '1.0.0',
  status: 'completed',
  is_deleted: false,
  deleted_at: null,
  deleted_by: null,
  deleted_by_username: null,
  deletion_mode: '',
  scheduled_hard_delete_at: null,
  original_status: '',
  cache_hit: false,
  cache_miss: true,
  progress_percentage: 100,
  progress_stage: 'completed',
  progress_message: 'Completed',
  progress_event_index: 1,
  supports_pause_resume: false,
  pause_requested: false,
  runtime_state: {},
  paused_at: null,
  resumed_at: null,
  parameters: {},
  results: null,
  error_trace: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

/** Busca un botón dentro de un contenedor por el texto (clave i18n renderizada). */
function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((btn) =>
    (btn.textContent ?? '').includes(text),
  );
}

describe('JobHistoryTableComponent (modo abierto, localRecords)', () => {
  let fixture: ComponentFixture<JobHistoryTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobHistoryTableComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
      providers: [{ provide: JobAccessModeService, useValue: { isOpenMode: signal(true) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(JobHistoryTableComponent);
  });

  it('lists local history, marks expired records, and emits open/remove actions', () => {
    const component = fixture.componentInstance;
    component.localRecords = [record('pending-job', 'pending'), record('expired-job', 'failed', true)];
    const openJob = vi.spyOn(component.openJob, 'emit');
    const deleteJob = vi.spyOn(component.deleteJob, 'emit');
    fixture.detectChanges();

    // El catálogo real de en.json se carga en los tests (test-setup.ts).
    expect(fixture.nativeElement.textContent).toContain('Expired on the server');
    const firstRow = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    const openButton = buttonWithText(firstRow, 'Open');
    const removeButton = buttonWithText(firstRow, 'Remove');
    expect(openButton).toBeDefined();
    expect(removeButton).toBeDefined();
    openButton?.click();
    removeButton?.click();
    expect(openJob).toHaveBeenCalledWith('pending-job');
    expect(deleteJob).toHaveBeenCalledWith('pending-job');
  });

  it('conserva la clase status-chip junto al modificador de estado (regresión de [class])', () => {
    const component = fixture.componentInstance;
    component.localRecords = [record('pending-job', 'pending'), record('expired-job', 'failed', true)];
    fixture.detectChanges();

    const chipByJobId = (jobId: string): DOMTokenList => {
      const row = Array.from(fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>).find(
        (tr) => (tr.textContent ?? '').includes(jobId),
      );
      const chip = row?.querySelector('.status-chip') as HTMLElement;
      return chip.classList;
    };

    // El binding [class] reemplaza el atributo estático: statusClass() debe
    // incluir la base .status-chip (forma de píldora global) y el modificador.
    expect(chipByJobId('pending-job').contains('status-chip')).toBe(true);
    expect(chipByJobId('pending-job').contains('is-pending')).toBe(true);
    expect(chipByJobId('expired-job').contains('status-chip')).toBe(true);
    expect(chipByJobId('expired-job').contains('is-expired')).toBe(true);
  });
});

describe('JobHistoryTableComponent (modo autenticado, jobs)', () => {
  let fixture: ComponentFixture<JobHistoryTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobHistoryTableComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
      providers: [{ provide: JobAccessModeService, useValue: { isOpenMode: signal(false) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(JobHistoryTableComponent);
  });

  it('muestra el mensaje de vacío cuando no hay jobs', () => {
    const component = fixture.componentInstance;
    component.jobs = [];
    component.emptyMessage = 'No historical jobs yet.';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No historical jobs yet.');
  });

  it('renderiza jobs, conserva status-chip y muestra delete solo en estados terminales', () => {
    const component = fixture.componentInstance;
    component.jobs = [
      buildJob({ id: 'done-job', status: 'completed' }),
      buildJob({ id: 'run-job', status: 'running' }),
    ];
    fixture.detectChanges();

    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>,
    );
    expect(rows).toHaveLength(2);

    for (const [rowIndex, expectedModifier, expectedDelete] of [
      [0, 'is-completed', true],
      [1, 'is-running', false],
    ] as const) {
      const chip = rows[rowIndex].querySelector('.status-chip') as HTMLElement;
      expect(chip.classList.contains('status-chip')).toBe(true);
      expect(chip.classList.contains(expectedModifier)).toBe(true);
      const deleteButton = buttonWithText(rows[rowIndex], 'Delete');
      expect(Boolean(deleteButton)).toBe(expectedDelete);
    }

    // Open sigue disponible para ambos estados.
    const openButton = buttonWithText(rows[0], 'Open');
    const openSpy = vi.spyOn(component.openJob, 'emit');
    openButton?.click();
    expect(openSpy).toHaveBeenCalledWith('done-job');
  });

  it('usa el resolvedor de nombre visible cuando está configurado', () => {
    const component = fixture.componentInstance;
    component.jobs = [buildJob({ id: 'named-job' })];
    component.jobDisplayNameResolver = () => 'Mi corrida';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Mi corrida');
  });

  it('canDeleteJob retorna true solo para estados terminales', () => {
    const component = fixture.componentInstance;
    expect(component.canDeleteJob(buildJob({ status: 'completed' }))).toBe(true);
    expect(component.canDeleteJob(buildJob({ status: 'failed' }))).toBe(true);
    expect(component.canDeleteJob(buildJob({ status: 'cancelled' }))).toBe(true);
    expect(component.canDeleteJob(buildJob({ status: 'running' }))).toBe(false);
    expect(component.canDeleteJob(buildJob({ status: 'pending' }))).toBe(false);
  });
});

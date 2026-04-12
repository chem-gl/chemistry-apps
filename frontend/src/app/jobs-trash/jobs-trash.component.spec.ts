// jobs-trash.component.spec.ts: Pruebas unitarias de la pantalla de papelera.
// Verifica la carga inicial, refresco, filtros y restauración delegada al facade.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ScientificJobView } from '../core/api/jobs-api.service';
import { JobsMonitorFacadeService } from '../core/application/jobs-monitor.facade.service';
import { JobsTrashComponent } from './jobs-trash.component';

function makeDeletedJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'trash-job-1',
    job_hash: 'trash-hash-1',
    plugin_name: 'random-numbers',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Done',
    progress_event_index: 10,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: null,
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: new Date().toISOString(),
    scheduled_hard_delete_at: new Date().toISOString(),
    ...overrides,
  } as ScientificJobView;
}

describe('JobsTrashComponent', () => {
  const facadeMock = {
    jobs: signal<ScientificJobView[]>([makeDeletedJob()]),
    isLoading: signal<boolean>(false),
    errorMessage: signal<string | null>(null),
    controlErrorMessage: signal<string | null>(null),
    selectedStatus: signal<string>('all'),
    selectedPluginName: signal<string>('all'),
    pluginOptions: signal<string[]>(['all', 'random-numbers']),
    loadDeletedJobs: vi.fn(),
    setStatusFilter: vi.fn(),
    setPluginFilter: vi.fn(),
    deleteJob: vi.fn(),
    restoreJob: vi.fn(),
    isControlActionRunning: vi.fn(() => false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    facadeMock.jobs.set([makeDeletedJob()]);
    facadeMock.selectedStatus.set('all');
    facadeMock.selectedPluginName.set('all');

    TestBed.configureTestingModule({
      imports: [JobsTrashComponent],
      providers: [provideRouter([])],
    });

    TestBed.overrideComponent(JobsTrashComponent, {
      set: {
        providers: [{ provide: JobsMonitorFacadeService, useValue: facadeMock }],
      },
    });
  });

  it('carga la papelera al inicializar', () => {
    const fixture = TestBed.createComponent(JobsTrashComponent);

    fixture.detectChanges();

    expect(facadeMock.loadDeletedJobs).toHaveBeenCalled();
  });

  it('refresca y delega restauración y borrado permanente al facade', () => {
    const fixture = TestBed.createComponent(JobsTrashComponent);
    const component = fixture.componentInstance;

    component.refreshNow();
    component.restoreJob('trash-job-1');
    component.deleteJobPermanently('trash-job-1');

    expect(facadeMock.loadDeletedJobs).toHaveBeenCalled();
    expect(facadeMock.restoreJob).toHaveBeenCalledWith('trash-job-1');
    expect(facadeMock.deleteJob).toHaveBeenCalledWith('trash-job-1');
  });

  it('recarga la papelera cuando cambian filtros', () => {
    const fixture = TestBed.createComponent(JobsTrashComponent);
    const component = fixture.componentInstance;

    component.onStatusFilterChanged('failed');
    component.onPluginFilterChanged('random-numbers');

    expect(facadeMock.setStatusFilter).toHaveBeenCalledWith('failed');
    expect(facadeMock.setPluginFilter).toHaveBeenCalledWith('random-numbers');
    expect(facadeMock.loadDeletedJobs).toHaveBeenCalledTimes(2);
  });
});

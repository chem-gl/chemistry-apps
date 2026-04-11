// jobs-monitor.component.spec.ts: Pruebas unitarias del componente Jobs Monitor.
// Cubre delegaciones al facade, clasificación de estados, rutas por plugin y labels de acción.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ScientificJobView } from '../core/api/jobs-api.service';
import { JobsMonitorFacadeService } from '../core/application/jobs-monitor.facade.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobsMonitorComponent } from './jobs-monitor.component';

function makeJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'jm-1',
    job_hash: 'hash-1',
    plugin_name: 'random-numbers',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Done',
    progress_event_index: 5,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {},
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ScientificJobView;
}

describe('JobsMonitorComponent', () => {
  const sessionServiceMock = {
    canAccessRoute: vi.fn((routeKey: string) => routeKey !== 'unknown-plugin'),
    hasAdminAccess: vi.fn(() => true),
    canManageJob: vi.fn(() => true),
    canDeleteJob: vi.fn(() => true),
    canRestoreJob: vi.fn(() => true),
    resolveDeleteMode: vi.fn((): 'hard' | 'soft' | null => 'hard'),
  };

  const facadeMock = {
    jobs: signal<ScientificJobView[]>([]),
    isLoading: signal<boolean>(false),
    errorMessage: signal<string | null>(null),
    selectedStatus: signal<string>('all'),
    selectedPluginName: signal<string>('all'),
    autoRefreshEnabled: signal<boolean>(true),
    lastUpdatedAt: signal<Date | null>(null),
    selectedJobId: signal<string | null>(null),
    selectedJob: signal<ScientificJobView | null>(null),
    selectedJobLogs: signal<unknown[]>([]),
    isDetailsLoading: signal<boolean>(false),
    detailsErrorMessage: signal<string | null>(null),
    controllingJobId: signal<string | null>(null),
    controlErrorMessage: signal<string | null>(null),
    pluginOptions: signal<string[]>(['all']),
    activeJobs: signal<ScientificJobView[]>([]),
    pausedJobs: signal<ScientificJobView[]>([]),
    completedJobs: signal<ScientificJobView[]>([]),
    failedJobs: signal<ScientificJobView[]>([]),
    cancelledJobs: signal<ScientificJobView[]>([]),
    finishedJobs: signal<ScientificJobView[]>([]),
    loadJobs: vi.fn(),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
    toggleAutoRefresh: vi.fn(),
    setStatusFilter: vi.fn(),
    setPluginFilter: vi.fn(),
    openJobDetails: vi.fn(),
    closeJobDetails: vi.fn(),
    pauseJob: vi.fn(),
    resumeJob: vi.fn(),
    cancelJob: vi.fn(),
    deleteJob: vi.fn(),
    restoreJob: vi.fn(),
    isControlActionRunning: vi.fn(() => false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionServiceMock.canAccessRoute.mockClear();
    sessionServiceMock.hasAdminAccess.mockClear();
    sessionServiceMock.canManageJob.mockClear();
    sessionServiceMock.canDeleteJob.mockClear();
    sessionServiceMock.canRestoreJob.mockClear();
    sessionServiceMock.resolveDeleteMode.mockClear();

    facadeMock.jobs.set([]);
    facadeMock.isLoading.set(false);
    facadeMock.selectedJob.set(null);
    facadeMock.selectedJobId.set(null);

    TestBed.configureTestingModule({
      imports: [JobsMonitorComponent],
      providers: [
        provideRouter([]),
        { provide: IdentitySessionService, useValue: sessionServiceMock },
      ],
    });

    TestBed.overrideComponent(JobsMonitorComponent, {
      set: {
        providers: [{ provide: JobsMonitorFacadeService, useValue: facadeMock }],
      },
    });
  });

  it('llama loadJobs y startAutoRefresh al inicializar', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    fixture.detectChanges();
    expect(facadeMock.loadJobs).toHaveBeenCalled();
    expect(facadeMock.startAutoRefresh).toHaveBeenCalled();
  });

  it('llama stopAutoRefresh al destruir el componente', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    fixture.detectChanges();
    fixture.destroy();
    expect(facadeMock.stopAutoRefresh).toHaveBeenCalled();
  });

  it('delega refreshNow al facade.loadJobs', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    component.refreshNow();
    expect(facadeMock.loadJobs).toHaveBeenCalled();
  });

  it('delega toggleAutoRefresh al facade', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    component.toggleAutoRefresh();
    expect(facadeMock.toggleAutoRefresh).toHaveBeenCalled();
  });

  it('delega onStatusFilterChanged al facade', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    component.onStatusFilterChanged('running');
    expect(facadeMock.setStatusFilter).toHaveBeenCalledWith('running');
  });

  it('delega onPluginFilterChanged al facade', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    component.onPluginFilterChanged('random-numbers');
    expect(facadeMock.setPluginFilter).toHaveBeenCalledWith('random-numbers');
  });

  it('delega openJobDetails, closeJobDetails, pauseJob, resumeJob, cancelJob, deleteJob y restoreJob', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;

    component.openJobDetails('jm-10');
    component.closeJobDetails();
    component.pauseJob('jm-10');
    component.resumeJob('jm-10');
    component.cancelJob('jm-10');
    component.deleteJob('jm-10');
    component.restoreJob('jm-10');

    expect(facadeMock.openJobDetails).toHaveBeenCalledWith('jm-10');
    expect(facadeMock.closeJobDetails).toHaveBeenCalled();
    expect(facadeMock.pauseJob).toHaveBeenCalledWith('jm-10');
    expect(facadeMock.resumeJob).toHaveBeenCalledWith('jm-10');
    expect(facadeMock.cancelJob).toHaveBeenCalledWith('jm-10');
    expect(facadeMock.deleteJob).toHaveBeenCalledWith('jm-10');
    expect(facadeMock.restoreJob).toHaveBeenCalledWith('jm-10');
  });

  it('statusClassName retorna clases CSS combinadas para estado del job', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    expect(component.statusClassName('running')).toBe('job-status status-running');
    expect(component.statusClassName('completed')).toBe('job-status status-completed');
    expect(component.statusClassName('failed')).toBe('job-status status-failed');
  });

  it('stageClassName retorna clase de pill para etapa de progreso', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    expect(component.stageClassName('queued')).toBe('stage-pill stage-queued');
    expect(component.stageClassName('running')).toBe('stage-pill stage-running');
  });

  it('appRouteForJob retorna la ruta correcta según plugin_name', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;

    const routes: Array<[string, string | null]> = [
      ['random-numbers', '/random-numbers'],
      ['calculator', '/calculator'],
      ['molar-fractions', '/molar-fractions'],
      ['tunnel-effect', '/tunnel'],
      ['easy-rate', '/easy-rate'],
      ['marcus', '/marcus'],
      ['smileit', '/smileit'],
      ['unknown-plugin', null],
    ];

    for (const [pluginName, expectedRoute] of routes) {
      expect(component.appRouteForJob(makeJob({ plugin_name: pluginName }))).toBe(expectedRoute);
    }
  });

  it('resultActionLabel retorna "View summary" para random-numbers sin resultado final', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    const incompleteRandomJob = makeJob({
      plugin_name: 'random-numbers',
      results: null,
    });
    expect(component.resultActionLabel(incompleteRandomJob)).toBe('View summary');
  });

  it('resultActionLabel retorna "Open result" para job con resultados finales', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;

    const completedRandomJob = makeJob({
      plugin_name: 'random-numbers',
      results: {
        generated_numbers: [1, 2, 3],
        metadata: { seed_url: 'x', seed_digest: 'y', total_numbers: 3 },
      },
    });

    const calculatorJob = makeJob({ plugin_name: 'calculator', results: { value: 42 } });

    expect(component.resultActionLabel(completedRandomJob)).toBe('Open result');
    expect(component.resultActionLabel(calculatorJob)).toBe('Open result');
  });

  it('canDeleteJob y deleteActionLabel respetan la jerarquía resuelta por la sesión', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    const completedJob = makeJob({ status: 'completed' });
    const softDeleteMode = 'soft' as const;

    sessionServiceMock.canDeleteJob.mockReturnValueOnce(true);
    sessionServiceMock.resolveDeleteMode.mockReturnValueOnce(softDeleteMode);

    expect(component.canDeleteJob(completedJob)).toBe(true);
    expect(component.deleteActionLabel(completedJob)).toBe('Move to trash');
  });

  it('canDeleteJob rechaza jobs no terminales aunque la sesión tenga permisos', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;

    expect(component.canDeleteJob(makeJob({ status: 'running' }))).toBe(false);
  });

  it('expone las opciones de estado en statusOptions', () => {
    const fixture = TestBed.createComponent(JobsMonitorComponent);
    const component = fixture.componentInstance;
    const values = component.statusOptions.map((o) => o.value);
    expect(values).toContain('all');
    expect(values).toContain('running');
    expect(values).toContain('completed');
    expect(values).toContain('failed');
  });
});

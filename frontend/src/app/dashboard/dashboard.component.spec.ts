// dashboard.component.spec.ts: Pruebas del dashboard principal adaptado por rol.
// Verifica carga de jobs, alcance de identidad y eliminación de jobs terminales.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentityApiService } from '../core/api/identity-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  const sessionServiceMock = {
    initializeSession: vi.fn(),
    hasAdminAccess: vi.fn(),
    accessibleApps: vi.fn(),
    canAccessRoute: vi.fn(),
    canDeleteJob: vi.fn(),
    resolveDeleteMode: vi.fn(),
  };

  const jobsApiServiceMock = {
    listJobs: vi.fn(),
    deleteJob: vi.fn(),
  };

  const identityApiServiceMock = {
    listUsers: vi.fn(),
    listGroups: vi.fn(),
  };

  const translocoServiceMock = {
    translate: vi.fn((key: string) => key),
  };

  const jobs = [
    { id: 'job-1', status: 'running', plugin_name: 'smileit', owner: 1, group: 2 },
    { id: 'job-2', status: 'completed', plugin_name: 'marcus-kinetics', owner: 1, group: 2 },
    { id: 'job-3', status: 'paused', plugin_name: 'unknown', owner: 3, group: 4 },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionServiceMock.initializeSession.mockReturnValue(of(true));
    sessionServiceMock.hasAdminAccess.mockReturnValue(true);
    sessionServiceMock.accessibleApps.mockReturnValue([
      { route_key: 'smileit', enabled: true },
      { route_key: 'marcus', enabled: true },
    ]);
    sessionServiceMock.canAccessRoute.mockReturnValue(true);
    sessionServiceMock.canDeleteJob.mockReturnValue(true);
    sessionServiceMock.resolveDeleteMode.mockReturnValue('soft');
    jobsApiServiceMock.listJobs.mockReturnValue(of(jobs));
    jobsApiServiceMock.deleteJob.mockReturnValue(of(void 0));
    identityApiServiceMock.listUsers.mockReturnValue(of([{ id: 1, username: 'alice' }]));
    identityApiServiceMock.listGroups.mockReturnValue(of([{ id: 2, name: 'Alpha' }]));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: IdentitySessionService, useValue: sessionServiceMock },
        { provide: JobsApiService, useValue: jobsApiServiceMock },
        { provide: IdentityApiService, useValue: identityApiServiceMock },
        { provide: TranslocoService, useValue: translocoServiceMock },
      ],
    }).compileComponents();
  });

  it('carga jobs y alcance de identidad cuando la sesión está autenticada', () => {
    // Verifica el flujo completo de carga inicial del dashboard para admin/root.
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(component.visibleJobs()).toHaveLength(3);
    expect(component.visibleUsers()).toHaveLength(1);
    expect(component.visibleGroups()).toHaveLength(1);
    expect(component.runningJobsCount()).toBe(1);
    expect(component.completedJobsCount()).toBe(1);
    expect(component.pausedJobsCount()).toBe(1);
    expect(component.recentJobs()).toHaveLength(3);
    expect(component.enabledApps()).toHaveLength(2);
    expect(component.isLoading()).toBe(false);
    expect(component.recentJobRoutePath(jobs[1] as never)).toBe('/marcus');
  });

  it('corta la carga cuando initializeSession devuelve falso', () => {
    // Verifica la rama donde no hay sesión válida y no deben consultarse APIs adicionales.
    sessionServiceMock.initializeSession.mockReturnValue(of(false));
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(jobsApiServiceMock.listJobs).not.toHaveBeenCalled();
    expect(component.isLoading()).toBe(false);
  });

  it('muestra error si falla la carga inicial de jobs o la carga de identidad', () => {
    // Verifica ambas ramas de error asíncrono del dashboard.
    jobsApiServiceMock.listJobs.mockReturnValueOnce(throwError(() => ({ message: 'Jobs failed' })));
    const failedJobsFixture = TestBed.createComponent(DashboardComponent);
    const failedJobsComponent = failedJobsFixture.componentInstance;
    failedJobsComponent.ngOnInit();

    identityApiServiceMock.listGroups.mockReturnValueOnce(
      throwError(() => ({ message: 'Groups failed' })),
    );
    const failedIdentityFixture = TestBed.createComponent(DashboardComponent);
    const failedIdentityComponent = failedIdentityFixture.componentInstance;
    failedIdentityComponent.ngOnInit();

    expect(failedJobsComponent.errorMessage()).toBe('Jobs failed');
    expect(failedIdentityComponent.errorMessage()).toBe('Groups failed');
  });

  it('resuelve rutas y etiquetas de navegación según plugin y permisos', () => {
    // Verifica que el dashboard no ofrezca links inválidos a resultados inaccesibles.
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    expect(component.recentJobRoutePath(jobs[0] as never)).toBe('/smileit');
    expect(component.recentJobNavigationLabel(jobs[0] as never)).toBe('common.actions.openResult');

    sessionServiceMock.canAccessRoute.mockReturnValue(false);

    expect(component.recentJobRoutePath(jobs[0] as never)).toBeNull();
    expect(component.recentJobNavigationLabel(jobs[0] as never)).toBe(
      'dashboard.jobs.resultUnavailable',
    );
  });

  it('expone reglas de borrado y elimina jobs terminales', () => {
    // Verifica el borrado exitoso y la remoción local del job de la lista visible.
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    expect(component.canDeleteJob(jobs[1] as never)).toBe(true);
    expect(component.deleteActionLabel(jobs[1] as never)).toBe('common.actions.moveToTrash');

    component.deleteJob('job-2');

    expect(component.visibleJobs().map((jobItem) => jobItem.id)).not.toContain('job-2');
    expect(component.isDeletingJob('job-2')).toBe(false);
  });

  it('muestra un mensaje si el borrado del job falla', () => {
    // Verifica la ruta de error del borrado para no perder feedback de la acción del usuario.
    jobsApiServiceMock.deleteJob.mockReturnValueOnce(
      throwError(() => new Error('Cannot delete job')),
    );
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.deleteJob('job-1');

    expect(component.deleteErrorMessage()).toBe('Cannot delete job');
    expect(component.isDeletingJob('job-1')).toBe(false);
  });
});

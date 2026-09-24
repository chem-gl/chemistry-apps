import { Injector, runInInjectionContext, signal } from '@angular/core';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { IdentitySessionService } from './identity-session.service';
import { JobAccessModeService } from './job-access-mode.service';

describe('JobAccessModeService', () => {
  it('tracks anonymous and authenticated modes', () => {
    const status = signal<'idle' | 'loading' | 'authenticated' | 'anonymous'>('anonymous');
    const injector = Injector.create({
      providers: [JobAccessModeService, { provide: IdentitySessionService, useValue: { status } }],
    });
    const service = runInInjectionContext(injector, () => injector.get(JobAccessModeService));

    expect(service.isOpenMode()).toBe(true);
    expect(service.mode()).toBe('open');
    expect(service.canUseJobControls()).toBe(false);
    status.set('authenticated');
    expect(service.isOpenMode()).toBe(false);
    expect(service.mode()).toBe('account');
    expect(service.canUseJobControls()).toBe(true);
  });

  it.each([
    { status: 429, key: 'appMode.open.limits.429' },
    { status: 413, key: 'appMode.open.limits.413' },
  ])('maps open-mode limit $status to its i18n key', ({ status, key }) => {
    const injector = Injector.create({
      providers: [
        JobAccessModeService,
        { provide: IdentitySessionService, useValue: { status: signal('anonymous') } },
        { provide: 'TranslocoService', useValue: { translate: (translationKey: string) => translationKey } },
      ],
    });
    const service = runInInjectionContext(injector, () => injector.get(JobAccessModeService));

    expect(service.openModeLimitMessage(new HttpErrorResponse({ status }))).toBe(key);
  });

  it('includes Retry-After for open-mode 429 and ignores limits in account mode', () => {    const status = signal<'idle' | 'loading' | 'authenticated' | 'anonymous'>('anonymous');
    const injector = Injector.create({
      providers: [JobAccessModeService, { provide: IdentitySessionService, useValue: { status } }],
    });
    const service = runInInjectionContext(injector, () => injector.get(JobAccessModeService));
    const response = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '30' }),
    });

    expect(service.openModeLimitMessage(response)).toContain('Retry-After: 30');
    status.set('authenticated');
    expect(service.openModeLimitMessage(response)).toBeNull();
  });

  it('resolves open mode from the public catalog with a single request', async () => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        JobAccessModeService,
        { provide: IdentitySessionService, useValue: { status: signal('anonymous') } },
      ],
    });
    const service = TestBed.inject(JobAccessModeService);
    const httpMock = TestBed.inject(HttpTestingController);

    const first = firstValueFrom(service.whenOpenModeKnown());
    const second = firstValueFrom(service.whenOpenModeKnown());
    const pending = httpMock.expectOne((request) => request.url.endsWith('/api/public/catalog/'));
    pending.flush({ mode: 'closed', apps: [] });

    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(service.openModeEnabled()).toBe(false);
    httpMock.verify();
  });

  it('defaults to CLOSED mode when the catalog is unreachable (fail-closed)', async () => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        JobAccessModeService,
        { provide: IdentitySessionService, useValue: { status: signal('anonymous') } },
      ],
    });
    const service = TestBed.inject(JobAccessModeService);
    const httpMock = TestBed.inject(HttpTestingController);

    const result = firstValueFrom(service.whenOpenModeKnown());
    const pending = httpMock.expectOne((request) => request.url.endsWith('/api/public/catalog/'));
    pending.error(new ProgressEvent('error'));

    expect(await result).toBe(false);
    expect(service.openModeEnabled()).toBe(false);
    httpMock.verify();
  });
});

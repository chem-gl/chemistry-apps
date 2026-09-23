import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
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
    status.set('authenticated');
    expect(service.isOpenMode()).toBe(false);
    expect(service.mode()).toBe('account');
  });
});

// auth-api.service.spec.ts: Verifica el mapeo del wrapper de autenticación y la rotación de refresh token.

import '@angular/compiler';

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthApiService } from './auth-api.service';
import { AuthService } from './generated';

describe('AuthApiService', () => {
  it('maps refresh response including rotated refresh token', async () => {
    const authClientMock = {
      authRefreshCreate: vi.fn(() =>
        of({
          access: 'access-next-token',
          refresh: 'refresh-next-token',
        }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [AuthApiService, { provide: AuthService, useValue: authClientMock }],
    });

    const service = TestBed.inject(AuthApiService);

    const tokens = await firstValueFrom(service.refresh('refresh-old-token'));

    expect(tokens).toEqual({
      accessToken: 'access-next-token',
      refreshToken: 'refresh-next-token',
    });
  });

  it('keeps previous refresh token when backend omits refresh value', async () => {
    const authClientMock = {
      authRefreshCreate: vi.fn(() =>
        of({
          access: 'access-next-token',
        }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [AuthApiService, { provide: AuthService, useValue: authClientMock }],
    });

    const service = TestBed.inject(AuthApiService);

    const tokens = await firstValueFrom(service.refresh('refresh-old-token'));

    expect(tokens).toEqual({
      accessToken: 'access-next-token',
      refreshToken: 'refresh-old-token',
    });
  });
});

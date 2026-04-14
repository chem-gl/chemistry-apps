// http-auth-token.interceptor.spec.ts: Pruebas del interceptor JWT con refresh automático.
// Verifica adjunción de bearer token, refresh serializado y manejo de sesión expirada.

import '@angular/compiler';

import { HttpErrorResponse, HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentitySessionService } from '../../auth/identity-session.service';
import { API_BASE_URL } from '../../shared/constants';
import { HttpAuthTokenInterceptor } from './http-auth-token.interceptor';

function createInterceptor(): HttpAuthTokenInterceptor {
  return TestBed.runInInjectionContext(() => new HttpAuthTokenInterceptor());
}

describe('HttpAuthTokenInterceptor', () => {
  const sessionServiceMock = {
    accessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionServiceMock.accessToken.mockReturnValue('access-token');
    sessionServiceMock.refreshAccessToken.mockReturnValue(of('refreshed-token'));

    TestBed.configureTestingModule({
      providers: [{ provide: IdentitySessionService, useValue: sessionServiceMock }],
    });
  });

  it('omite requests ajenos al backend o del bootstrap de auth', async () => {
    // Verifica que el interceptor no toque recursos públicos ni login/refresh.
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn(() => of(new HttpResponse({ status: 200 }))),
    };

    await firstValueFrom(interceptor.intercept(new HttpRequest('GET', '/assets/logo.svg'), next));
    await firstValueFrom(
      interceptor.intercept(new HttpRequest('POST', `${API_BASE_URL}/api/auth/login/`, null), next),
    );

    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(
      (next.handle as ReturnType<typeof vi.fn>).mock.calls[0][0].headers.has('Authorization'),
    ).toBe(false);
    expect(
      (next.handle as ReturnType<typeof vi.fn>).mock.calls[1][0].headers.has('Authorization'),
    ).toBe(false);
  });

  it('deja pasar la request cuando no existe access token', async () => {
    // Verifica que el flujo anónimo no falle por asumir tokens siempre presentes.
    sessionServiceMock.accessToken.mockReturnValue(null);
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn(() => of(new HttpResponse({ status: 200 }))),
    };

    await firstValueFrom(
      interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/`), next),
    );

    expect(next.handle).toHaveBeenCalledOnce();
    expect(
      (next.handle as ReturnType<typeof vi.fn>).mock.calls[0][0].headers.has('Authorization'),
    ).toBe(false);
  });

  it('adjunta bearer token en requests backend autenticadas', async () => {
    // Verifica el comportamiento base del interceptor para todas las APIs protegidas.
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn((request: HttpRequest<unknown>) =>
        of(new HttpResponse({ status: 200, body: request.headers.get('Authorization') })),
      ),
    };

    const response = await firstValueFrom(
      interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/`), next),
    );

    expect((response as HttpResponse<string>).body).toBe('Bearer access-token');
  });

  it('refresca el token tras un 401 y reintenta la request original', async () => {
    // Verifica la ruta de recuperación automática de sesión sin perder la operación original.
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn((request: HttpRequest<unknown>) => {
        const authHeader = request.headers.get('Authorization');
        if (authHeader === 'Bearer access-token') {
          return throwError(
            () => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }),
          );
        }

        return of(new HttpResponse({ status: 200, body: authHeader }));
      }),
    };

    const response = await firstValueFrom(
      interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/`), next),
    );

    expect(sessionServiceMock.refreshAccessToken).toHaveBeenCalledOnce();
    expect((response as HttpResponse<string>).body).toBe('Bearer refreshed-token');
  });

  it('cierra sesión cuando refresh devuelve null', async () => {
    // Verifica la ruta de sesión expirada para evitar reintentos silenciosos sin credenciales válidas.
    sessionServiceMock.refreshAccessToken.mockReturnValue(of(null));
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })),
      ),
    };

    await expect(
      firstValueFrom(
        interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/`), next),
      ),
    ).rejects.toMatchObject({ status: 401, statusText: 'Session expired' });
    expect(sessionServiceMock.logout).toHaveBeenCalledTimes(2);
  });

  it('espera un refresh en curso y reintenta con el nuevo token emitido', async () => {
    // Verifica la serialización de requests concurrentes para no disparar refresh duplicados.
    const refreshAccessToken$ = new Subject<string | null>();
    sessionServiceMock.refreshAccessToken.mockReturnValue(refreshAccessToken$);
    const interceptor = createInterceptor();

    const next: HttpHandler = {
      handle: vi.fn((request: HttpRequest<unknown>) => {
        const authHeader = request.headers.get('Authorization');
        if (authHeader === 'Bearer access-token') {
          return throwError(
            () => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }),
          );
        }

        return of(new HttpResponse({ status: 200, body: authHeader }));
      }),
    };

    const firstPendingResponse = firstValueFrom(
      interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/1/`), next),
    );
    const secondPendingResponse = firstValueFrom(
      interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/2/`), next),
    );

    refreshAccessToken$.next('queued-token');
    refreshAccessToken$.complete();

    const [firstResponse, secondResponse] = await Promise.all([
      firstPendingResponse,
      secondPendingResponse,
    ]);

    expect(sessionServiceMock.refreshAccessToken).toHaveBeenCalledOnce();
    expect((firstResponse as HttpResponse<string>).body).toBe('Bearer queued-token');
    expect((secondResponse as HttpResponse<string>).body).toBe('Bearer queued-token');
  });

  it('cierra sesión si el refresh falla con error', async () => {
    // Verifica que los errores del endpoint refresh no dejen el interceptor en estado inconsistente.
    sessionServiceMock.refreshAccessToken.mockReturnValue(
      throwError(() => new Error('refresh failed')),
    );
    const interceptor = createInterceptor();
    const next: HttpHandler = {
      handle: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })),
      ),
    };

    await expect(
      firstValueFrom(
        interceptor.intercept(new HttpRequest('GET', `${API_BASE_URL}/api/jobs/`), next),
      ),
    ).rejects.toThrow('refresh failed');
    expect(sessionServiceMock.logout).toHaveBeenCalledOnce();
  });
});

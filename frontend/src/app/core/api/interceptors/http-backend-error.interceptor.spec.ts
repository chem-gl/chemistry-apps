// http-backend-error.interceptor.spec.ts: Pruebas unitarias del interceptor que envía errores HTTP al modal global.

import '@angular/compiler';

import {
  HttpContext,
  HttpErrorResponse,
  HttpHandler,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  ERROR_NOTIFIER_PORT,
  ErrorNotifierPort,
} from '../../application/errors/error-notifier.port';
import { HttpBackendErrorInterceptor } from './http-backend-error.interceptor';
import { SKIP_GLOBAL_ERROR_MODAL } from './http-context-tokens';

describe('HttpBackendErrorInterceptor', () => {
  it('forwards successful HTTP responses without calling notifier', async () => {
    const notifier: ErrorNotifierPort = {
      showError: () => {},
      showMessage: () => {},
      showHttpError: () => {},
      dismiss: () => {},
    };
    const showHttpErrorSpy = vi.spyOn(notifier, 'showHttpError');

    TestBed.configureTestingModule({
      providers: [{ provide: ERROR_NOTIFIER_PORT, useValue: notifier }],
    });

    const interceptor = TestBed.runInInjectionContext(() => new HttpBackendErrorInterceptor());
    const request = new HttpRequest('GET', '/api/jobs');
    const handler: HttpHandler = {
      handle: () => of(new HttpResponse({ status: 200, body: { ok: true } })),
    };

    await firstValueFrom(interceptor.intercept(request, handler));

    expect(showHttpErrorSpy).not.toHaveBeenCalled();
  });

  it('sends HttpErrorResponse to notifier and rethrows', async () => {
    const notifier: ErrorNotifierPort = {
      showError: () => {},
      showMessage: () => {},
      showHttpError: () => {},
      dismiss: () => {},
    };
    const showHttpErrorSpy = vi.spyOn(notifier, 'showHttpError');

    TestBed.configureTestingModule({
      providers: [{ provide: ERROR_NOTIFIER_PORT, useValue: notifier }],
    });

    const interceptor = TestBed.runInInjectionContext(() => new HttpBackendErrorInterceptor());
    const request = new HttpRequest('GET', '/api/jobs');
    const httpError = new HttpErrorResponse({
      status: 502,
      statusText: 'Bad Gateway',
      error: { detail: 'Gateway timeout' },
      url: '/api/jobs',
    });

    const handler: HttpHandler = {
      handle: () => throwError(() => httpError),
    };

    await expect(firstValueFrom(interceptor.intercept(request, handler))).rejects.toBe(httpError);
    expect(showHttpErrorSpy).toHaveBeenCalledWith(httpError);
  });

  it('skips notifier when request context disables global modal handling', async () => {
    const notifier: ErrorNotifierPort = {
      showError: () => {},
      showMessage: () => {},
      showHttpError: () => {},
      dismiss: () => {},
    };
    const showHttpErrorSpy = vi.spyOn(notifier, 'showHttpError');

    TestBed.configureTestingModule({
      providers: [{ provide: ERROR_NOTIFIER_PORT, useValue: notifier }],
    });

    const interceptor = TestBed.runInInjectionContext(() => new HttpBackendErrorInterceptor());
    const request = new HttpRequest('POST', '/api/smileit/jobs/inspect-structure/', null, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_MODAL, true),
    });
    const httpError = new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
      error: { detail: 'Invalid SMILES' },
      url: '/api/smileit/jobs/inspect-structure/',
    });

    const handler: HttpHandler = {
      handle: () => throwError(() => httpError),
    };

    await expect(firstValueFrom(interceptor.intercept(request, handler))).rejects.toBe(httpError);
    expect(showHttpErrorSpy).not.toHaveBeenCalled();
  });
});

// http-auth-token.interceptor.ts: Adjunta bearer token y refresca automáticamente ante 401.

import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { IdentitySessionService } from '../../auth/identity-session.service';
import { API_BASE_URL } from '../../shared/constants';

@Injectable()
export class HttpAuthTokenInterceptor implements HttpInterceptor {
  private readonly identitySessionService = inject(IdentitySessionService);

  /** Indica si ya hay un refresh en curso para serializar peticiones concurrentes. */
  private isRefreshing = false;
  /** Emite el nuevo access token cuando el refresh finaliza (null mientras está en curso). */
  private readonly refreshedToken$ = new BehaviorSubject<string | null>(null);

  intercept(httpRequest: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const isBackendRequest = httpRequest.url.startsWith(API_BASE_URL);
    const isAuthBootstrapRequest =
      httpRequest.url.endsWith('/api/auth/login/') ||
      httpRequest.url.endsWith('/api/auth/refresh/');

    if (!isBackendRequest || isAuthBootstrapRequest) {
      return next.handle(httpRequest);
    }

    const accessToken = this.identitySessionService.accessToken();
    if (accessToken === null) {
      return next.handle(httpRequest);
    }

    return next.handle(this.attachToken(httpRequest, accessToken)).pipe(
      catchError((httpError: HttpErrorResponse) => {
        if (httpError.status !== 401) {
          return throwError(() => httpError);
        }

        return this.handleTokenExpired(httpRequest, next);
      }),
    );
  }

  /**
   * Maneja la expiración del token: ejecuta refresh si no hay uno en curso,
   * o espera al refresh en curso y reintenta con el nuevo token.
   */
  private handleTokenExpired(
    failedRequest: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    if (this.isRefreshing) {
      return this.waitForRefreshAndRetry(failedRequest, next);
    }

    this.isRefreshing = true;
    this.refreshedToken$.next(null);

    return this.identitySessionService.refreshAccessToken().pipe(
      switchMap((newAccessToken: string | null) => {
        this.isRefreshing = false;

        if (newAccessToken === null) {
          this.identitySessionService.logout();
          return throwError(
            () =>
              new HttpErrorResponse({
                status: 401,
                statusText: 'Session expired',
              }),
          );
        }

        this.refreshedToken$.next(newAccessToken);
        return next.handle(this.attachToken(failedRequest, newAccessToken));
      }),
      catchError((refreshError: unknown) => {
        this.isRefreshing = false;
        this.identitySessionService.logout();
        return throwError(() => refreshError);
      }),
    );
  }

  /**
   * Cuando ya hay un refresh en curso, espera al nuevo token y reintenta.
   */
  private waitForRefreshAndRetry(
    queuedRequest: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    return this.refreshedToken$.pipe(
      filter((token: string | null): token is string => token !== null),
      take(1),
      switchMap((newAccessToken: string) =>
        next.handle(this.attachToken(queuedRequest, newAccessToken)),
      ),
    );
  }

  private attachToken(httpRequest: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return httpRequest.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }
}

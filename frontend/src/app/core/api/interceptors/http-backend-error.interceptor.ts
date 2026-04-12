// http-backend-error.interceptor.ts: Interceptor DI que enruta errores HTTP al modal global reutilizable.

import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  ERROR_NOTIFIER_PORT,
  ErrorNotifierPort,
} from '../../application/errors/error-notifier.port';
import { SKIP_GLOBAL_ERROR_MODAL } from './http-context-tokens';

@Injectable()
export class HttpBackendErrorInterceptor implements HttpInterceptor {
  private readonly errorNotifier: ErrorNotifierPort = inject(ERROR_NOTIFIER_PORT);

  intercept(httpRequest: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(httpRequest).pipe(
      catchError((httpError: HttpErrorResponse) => {
        // Los 401 los gestiona HttpAuthTokenInterceptor con refresh automático.
        if (httpError.status === 401) {
          return throwError(() => httpError);
        }

        if (httpRequest.context.get(SKIP_GLOBAL_ERROR_MODAL)) {
          return throwError(() => httpError);
        }

        this.errorNotifier.showHttpError(httpError);
        return throwError(() => httpError);
      }),
    );
  }
}

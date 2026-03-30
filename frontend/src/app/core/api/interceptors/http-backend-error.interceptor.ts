// http-backend-error.interceptor.ts: Interceptor DI que enruta errores HTTP al modal global reutilizable.

import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  ERROR_NOTIFIER_PORT,
  ErrorNotifierPort,
} from '../../application/errors/error-notifier.port';

@Injectable()
export class HttpBackendErrorInterceptor implements HttpInterceptor {
  constructor(@Inject(ERROR_NOTIFIER_PORT) private readonly errorNotifier: ErrorNotifierPort) {}

  intercept(httpRequest: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(httpRequest).pipe(
      catchError((httpError: HttpErrorResponse) => {
        this.errorNotifier.showHttpError(httpError);
        return throwError(() => httpError);
      }),
    );
  }
}

// http-auth-token.interceptor.ts: Adjunta bearer token a peticiones backend autenticadas.

import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { IdentitySessionService } from '../../auth/identity-session.service';
import { API_BASE_URL } from '../../shared/constants';

@Injectable()
export class HttpAuthTokenInterceptor implements HttpInterceptor {
  private readonly identitySessionService = inject(IdentitySessionService);

  intercept(httpRequest: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const accessToken = this.identitySessionService.accessToken();
    const isBackendRequest = httpRequest.url.startsWith(API_BASE_URL);
    const isAuthBootstrapRequest =
      httpRequest.url.endsWith('/api/auth/login/') || httpRequest.url.endsWith('/api/auth/refresh/');

    if (!isBackendRequest || isAuthBootstrapRequest || accessToken === null) {
      return next.handle(httpRequest);
    }

    const authorizedRequest = httpRequest.clone({
      setHeaders: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return next.handle(authorizedRequest);
  }
}

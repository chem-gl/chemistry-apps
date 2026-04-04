// app.config.ts: Configuracion global de proveedores e integracion API

import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideApi } from './core/api/generated';
import { HttpBackendErrorInterceptor } from './core/api/interceptors/http-backend-error.interceptor';
import { ERROR_NOTIFIER_PORT } from './core/application/errors/error-notifier.port';
import { GlobalErrorModalService } from './core/application/errors/global-error-modal.service';
import { GlobalRuntimeErrorHandler } from './core/application/errors/global-runtime-error.handler';
import { API_BASE_URL } from './core/shared/constants';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    provideApi(API_BASE_URL),
    {
      provide: ERROR_NOTIFIER_PORT,
      useExisting: GlobalErrorModalService,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: HttpBackendErrorInterceptor,
      multi: true,
    },
    {
      provide: ErrorHandler,
      useClass: GlobalRuntimeErrorHandler,
    },
  ],
};

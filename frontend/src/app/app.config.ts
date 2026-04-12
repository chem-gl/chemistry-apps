// app.config.ts: Configuracion global de proveedores e integracion API

import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideApi } from './core/api/generated';
import { HttpAuthTokenInterceptor } from './core/api/interceptors/http-auth-token.interceptor';
import { HttpBackendErrorInterceptor } from './core/api/interceptors/http-backend-error.interceptor';
import { ERROR_NOTIFIER_PORT } from './core/application/errors/error-notifier.port';
import { GlobalErrorModalService } from './core/application/errors/global-error-modal.service';
import { GlobalRuntimeErrorHandler } from './core/application/errors/global-runtime-error.handler';
import { SUPPORTED_LANGUAGE_CODES } from './core/i18n/supported-languages';
import { TranslocoHttpLoader } from './core/i18n/transloco.loader';
import { API_BASE_URL } from './core/shared/constants';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    provideTransloco({
      config: {
        availableLangs: [...SUPPORTED_LANGUAGE_CODES],
        defaultLang: 'en',
        fallbackLang: 'en',
        missingHandler: {
          // Si falta una clave en el idioma activo, usa el valor del idioma de fallback (inglés)
          useFallbackTranslation: true,
          logMissingKey: !isDevMode(),
        },
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
    provideApi(API_BASE_URL),
    {
      provide: ERROR_NOTIFIER_PORT,
      useExisting: GlobalErrorModalService,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: HttpAuthTokenInterceptor,
      multi: true,
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

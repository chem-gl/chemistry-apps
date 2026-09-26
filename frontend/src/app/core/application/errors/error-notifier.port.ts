// error-notifier.port.ts: Contrato DI para notificar errores de forma desacoplada.

import { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

export interface ErrorModalViewModel {
  /** Texto inicial mostrado (traducción sincrónica o mensaje crudo del backend). */
  title: string;
  message: string;
  details: string | null;
  /**
   * Claves Transloco opcionales. Cuando existen, la plantilla del modal resuelve
   * el texto en cada ciclo de cambio de detección, de modo que el idioma se
   * corrige en cuanto el catálogo termina de cargar (sin strings congelados).
   */
  titleKey?: string;
  messageKey?: string;
}

export interface ErrorNotifierPort {
  showError(viewModel: ErrorModalViewModel): void;
  showMessage(message: string, title?: string): void;
  showHttpError(httpError: HttpErrorResponse): void;
  dismiss(): void;
}

export const ERROR_NOTIFIER_PORT = new InjectionToken<ErrorNotifierPort>('ERROR_NOTIFIER_PORT');

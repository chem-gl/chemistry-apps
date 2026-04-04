// error-notifier.port.ts: Contrato DI para notificar errores de forma desacoplada.

import { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

export interface ErrorModalViewModel {
  title: string;
  message: string;
  details: string | null;
}

export interface ErrorNotifierPort {
  showError(viewModel: ErrorModalViewModel): void;
  showMessage(message: string, title?: string): void;
  showHttpError(httpError: HttpErrorResponse): void;
  dismiss(): void;
}

export const ERROR_NOTIFIER_PORT = new InjectionToken<ErrorNotifierPort>('ERROR_NOTIFIER_PORT');

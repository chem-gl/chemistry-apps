// global-runtime-error.handler.ts: ErrorHandler global para capturar errores no controlados del frontend.

import { ErrorHandler, Injectable, inject } from '@angular/core';
import {
  ERROR_NOTIFIER_PORT,
  ErrorModalViewModel,
  ErrorNotifierPort,
} from './error-notifier.port';

const APPLICATION_ERROR_TITLE = 'Application error';
const UNEXPECTED_CLIENT_ERROR_MESSAGE = 'An unexpected client-side error occurred.';

@Injectable()
export class GlobalRuntimeErrorHandler implements ErrorHandler {
  private readonly errorNotifier: ErrorNotifierPort = inject(ERROR_NOTIFIER_PORT);

  handleError(error: unknown): void {
    this.errorNotifier.showError(this.buildViewModel(error));
    console.error(error);
  }

  /** Construye el view model con claves Transloco para que el modal traduzca el título y el mensaje. */
  private buildViewModel(error: unknown): ErrorModalViewModel {
    const normalizedMessage: string | null = this.extractMessage(error);

    return {
      title: APPLICATION_ERROR_TITLE,
      titleKey: 'errorModal.runtime.applicationErrorTitle',
      message: normalizedMessage ?? UNEXPECTED_CLIENT_ERROR_MESSAGE,
      messageKey: normalizedMessage === null ? 'errorModal.runtime.unexpectedClientError' : undefined,
      details: null,
    };
  }

  private extractMessage(error: unknown): string | null {
    if (error instanceof Error && error.message.trim() !== '') {
      return error.message;
    }

    if (typeof error === 'string' && error.trim() !== '') {
      return error;
    }

    return null;
  }
}

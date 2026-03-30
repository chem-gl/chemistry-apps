// global-runtime-error.handler.ts: ErrorHandler global para capturar errores no controlados del frontend.

import { ErrorHandler, Inject, Injectable } from '@angular/core';
import { ERROR_NOTIFIER_PORT, ErrorNotifierPort } from './error-notifier.port';

@Injectable()
export class GlobalRuntimeErrorHandler implements ErrorHandler {
  constructor(@Inject(ERROR_NOTIFIER_PORT) private readonly errorNotifier: ErrorNotifierPort) {}

  handleError(error: unknown): void {
    const normalizedMessage = this.extractMessage(error);

    this.errorNotifier.showMessage(normalizedMessage, 'Application error');
    console.error(error);
  }

  private extractMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim() !== '') {
      return error;
    }

    return 'An unexpected client-side error occurred.';
  }
}

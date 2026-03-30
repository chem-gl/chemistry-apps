// global-error-modal.service.ts: Servicio reusable que centraliza errores para el modal global.

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { ErrorModalViewModel, ErrorNotifierPort } from './error-notifier.port';

@Injectable({ providedIn: 'root' })
export class GlobalErrorModalService implements ErrorNotifierPort {
  readonly currentError = signal<ErrorModalViewModel | null>(null);

  showError(viewModel: ErrorModalViewModel): void {
    this.currentError.set(viewModel);
  }

  showMessage(message: string, title: string = 'Unexpected error'): void {
    this.currentError.set({
      title,
      message,
      details: null,
    });
  }

  showHttpError(httpError: HttpErrorResponse): void {
    const detailMessage: string = this.extractHttpMessage(httpError);
    const detailsPayload: string | null = this.extractHttpDetails(httpError);

    this.currentError.set({
      title: 'Request failed',
      message: detailMessage,
      details: detailsPayload,
    });
  }

  dismiss(): void {
    this.currentError.set(null);
  }

  private extractHttpMessage(httpError: HttpErrorResponse): string {
    if (typeof httpError.error === 'string' && httpError.error.trim() !== '') {
      return httpError.error;
    }

    if (
      httpError.error !== null &&
      typeof httpError.error === 'object' &&
      'detail' in httpError.error &&
      typeof (httpError.error as { detail?: unknown }).detail === 'string'
    ) {
      return (httpError.error as { detail: string }).detail;
    }

    if (httpError.message.trim() !== '') {
      return httpError.message;
    }

    return 'The backend returned an unknown error.';
  }

  private extractHttpDetails(httpError: HttpErrorResponse): string | null {
    if (httpError.error !== null && typeof httpError.error === 'object') {
      try {
        return JSON.stringify(httpError.error, null, 2);
      } catch {
        return null;
      }
    }

    return null;
  }
}

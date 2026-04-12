// global-error-modal.service.ts: Servicio reusable que centraliza errores para el modal global.

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ErrorModalViewModel, ErrorNotifierPort } from './error-notifier.port';

@Injectable({ providedIn: 'root' })
export class GlobalErrorModalService implements ErrorNotifierPort {
  private readonly translocoService = inject(TranslocoService);
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
    const localizedMessage: string = this.mapKnownHttpError(httpError, detailMessage);

    this.currentError.set({
      title: this.translateOrFallback('errorModal.http.requestFailedTitle', 'Request failed'),
      message: localizedMessage,
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

  private mapKnownHttpError(httpError: HttpErrorResponse, rawMessage: string): string {
    if (httpError.status === 0) {
      return this.translateOrFallback(
        'errorModal.http.networkUnavailable',
        'Network unavailable. Please verify your connection.',
      );
    }

    if (httpError.status === 400) {
      return this.translateOrFallback(
        'errorModal.http.badRequest',
        'The request is invalid. Please verify the submitted data.',
      );
    }

    if (httpError.status === 401) {
      return this.translateOrFallback(
        'errorModal.http.unauthorized',
        'Your session is not authorized for this operation.',
      );
    }

    if (httpError.status === 403) {
      return this.translateOrFallback(
        'errorModal.http.forbidden',
        'You do not have permission to perform this action.',
      );
    }

    if (httpError.status === 404) {
      return this.translateOrFallback(
        'errorModal.http.notFound',
        'The requested resource was not found.',
      );
    }

    if (httpError.status >= 500) {
      return this.translateOrFallback(
        'errorModal.http.serverError',
        'The server reported an internal error. Please try again later.',
      );
    }

    return rawMessage;
  }

  private translateOrFallback(translationKey: string, fallbackText: string): string {
    const translatedText = this.translocoService.translate(translationKey);
    return translatedText === translationKey ? fallbackText : translatedText;
  }
}

// global-error-modal.service.ts: Servicio reusable que centraliza errores para el modal global.

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ErrorModalViewModel, ErrorNotifierPort } from './error-notifier.port';

/** Título mostrado mientras el catálogo activo no resuelva la clave de título. */
const REQUEST_FAILED_TITLE = 'Request failed';

/** Clave Transloco del error HTTP conocido según su estado; null si es desconocido. */
const HTTP_STATUS_MESSAGE_KEY: Record<number, string | null> = {
  0: 'errorModal.http.networkUnavailable',
  400: 'errorModal.http.badRequest',
  401: 'errorModal.http.unauthorized',
  403: 'errorModal.http.forbidden',
  404: 'errorModal.http.notFound',
};

interface KnownHttpMessage {
  translationKey: string | null;
  fallbackText: string;
}

@Injectable({ providedIn: 'root' })
export class GlobalErrorModalService implements ErrorNotifierPort {
  private readonly translocoService = inject(TranslocoService);
  readonly currentError = signal<ErrorModalViewModel | null>(null);

  showError(viewModel: ErrorModalViewModel): void {
    this.currentError.set(viewModel);
  }

  showMessage(message: string, title?: string): void {
    const resolvedTitle: string = title ?? 'Unexpected error';
    this.currentError.set(
      title === undefined
        ? { title: resolvedTitle, titleKey: 'errorModal.runtime.unexpectedErrorTitle', message, details: null }
        : { title: resolvedTitle, message, details: null },
    );
  }

  showHttpError(httpError: HttpErrorResponse): void {
    const detailMessage: string = this.extractHttpMessage(httpError);
    const detailsPayload: string | null = this.extractHttpDetails(httpError);
    const knownMessage: KnownHttpMessage = this.resolveKnownHttpError(httpError, detailMessage);

    this.currentError.set({
      title: this.translateOrFallback('errorModal.http.requestFailedTitle', REQUEST_FAILED_TITLE),
      titleKey: 'errorModal.http.requestFailedTitle',
      message: knownMessage.fallbackText,
      messageKey: knownMessage.translationKey ?? undefined,
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

  /** Resuelve el texto visible y su clave Transloco para errores HTTP conocidos. */
  private resolveKnownHttpError(httpError: HttpErrorResponse, rawMessage: string): KnownHttpMessage {
    if (httpError.status >= 500) {
      const serverErrorKey = 'errorModal.http.serverError';
      return {
        translationKey: serverErrorKey,
        fallbackText: this.translateOrFallback(
          serverErrorKey,
          'The server reported an internal error. Please try again later.',
        ),
      };
    }

    const translationKey: string | null = HTTP_STATUS_MESSAGE_KEY[httpError.status] ?? null;
    if (translationKey === null) {
      return { translationKey: null, fallbackText: rawMessage };
    }

    return {
      translationKey,
      fallbackText: this.translateOrFallback(translationKey, this.englishFallbackFor(translationKey, rawMessage)),
    };
  }

  private englishFallbackFor(translationKey: string, rawMessage: string): string {
    const fallbackBySuffix: Record<string, string> = {
      networkUnavailable: 'Network unavailable. Please verify your connection.',
      badRequest: 'The request is invalid. Please verify the submitted data.',
      unauthorized: 'Your session is not authorized for this operation.',
      forbidden: 'You do not have permission to perform this action.',
      notFound: 'The requested resource was not found.',
    };
    const suffix: string = translationKey.split('.').pop() ?? '';
    return fallbackBySuffix[suffix] ?? rawMessage;
  }

  private translateOrFallback(translationKey: string, fallbackText: string): string {
    const translatedText = this.translocoService.translate(translationKey);
    return translatedText === translationKey ? fallbackText : translatedText;
  }
}

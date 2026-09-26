// global-runtime-error.handler.spec.ts: Pruebas unitarias del manejador global de errores de runtime.

import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_NOTIFIER_PORT,
  ErrorModalViewModel,
  ErrorNotifierPort,
} from './error-notifier.port';
import { GlobalRuntimeErrorHandler } from './global-runtime-error.handler';

describe('GlobalRuntimeErrorHandler', () => {
  let handler: GlobalRuntimeErrorHandler;
  let mockNotifier: ErrorNotifierPort;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const lastViewModel = (): ErrorModalViewModel =>
    (mockNotifier.showError as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as ErrorModalViewModel;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNotifier = {
      showError: vi.fn(),
      showMessage: vi.fn(),
      showHttpError: vi.fn(),
      dismiss: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        GlobalRuntimeErrorHandler,
        { provide: ERROR_NOTIFIER_PORT, useValue: mockNotifier },
      ],
    });

    handler = TestBed.inject(GlobalRuntimeErrorHandler);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('extrae el mensaje de un Error estándar y lo pasa al notifier con claves traducibles', () => {
    handler.handleError(new Error('Mensaje de error específico'));

    const viewModel = lastViewModel();
    expect(mockNotifier.showError).toHaveBeenCalledTimes(1);
    expect(viewModel.message).toBe('Mensaje de error específico');
    expect(viewModel.messageKey).toBeUndefined();
    expect(viewModel.title).toBe('Application error');
    expect(viewModel.titleKey).toBe('errorModal.runtime.applicationErrorTitle');
  });

  it('pasa el string directamente cuando el error es un string no vacío', () => {
    handler.handleError('error en formato string');

    expect(lastViewModel().message).toBe('error en formato string');
    expect(lastViewModel().messageKey).toBeUndefined();
  });

  it('usa mensaje genérico traducible cuando el error es un objeto no reconocido', () => {
    handler.handleError({ code: 500 });

    const viewModel = lastViewModel();
    expect(viewModel.message).toBe('An unexpected client-side error occurred.');
    expect(viewModel.messageKey).toBe('errorModal.runtime.unexpectedClientError');
  });

  it('usa mensaje genérico cuando el error es null', () => {
    handler.handleError(null);

    expect(lastViewModel().messageKey).toBe('errorModal.runtime.unexpectedClientError');
  });

  it('usa mensaje genérico cuando el error es un string vacío', () => {
    handler.handleError('   ');

    expect(lastViewModel().messageKey).toBe('errorModal.runtime.unexpectedClientError');
  });

  it('usa mensaje genérico cuando un Error llega sin mensaje', () => {
    handler.handleError(new Error(''));

    expect(lastViewModel().messageKey).toBe('errorModal.runtime.unexpectedClientError');
  });
});

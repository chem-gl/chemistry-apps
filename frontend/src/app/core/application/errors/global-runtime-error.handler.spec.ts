// global-runtime-error.handler.spec.ts: Pruebas unitarias del manejador global de errores de runtime.

import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_NOTIFIER_PORT, ErrorNotifierPort } from './error-notifier.port';
import { GlobalRuntimeErrorHandler } from './global-runtime-error.handler';

describe('GlobalRuntimeErrorHandler', () => {
  let handler: GlobalRuntimeErrorHandler;
  let mockNotifier: ErrorNotifierPort;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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

  it('extrae el mensaje de un Error estándar y lo pasa al notifier', () => {
    // Verifica que handleError delega al notifier con el mensaje correcto.
    const error = new Error('Mensaje de error específico');
    handler.handleError(error);

    expect(mockNotifier.showMessage).toHaveBeenCalledWith(
      'Mensaje de error específico',
      'Application error',
    );
  });

  it('pasa el string directamente cuando el error es un string no vacío', () => {
    // Verifica la rama donde el error es directamente un string.
    handler.handleError('error en formato string');

    expect(mockNotifier.showMessage).toHaveBeenCalledWith(
      'error en formato string',
      'Application error',
    );
  });

  it('usa mensaje genérico cuando el error es un objeto no reconocido', () => {
    // Verifica que valores desconocidos (objetos, null, undefined) usan el mensaje de fallback.
    handler.handleError({ code: 500 });

    expect(mockNotifier.showMessage).toHaveBeenCalledWith(
      'An unexpected client-side error occurred.',
      'Application error',
    );
  });

  it('usa mensaje genérico cuando el error es null', () => {
    handler.handleError(null);

    expect(mockNotifier.showMessage).toHaveBeenCalledWith(
      'An unexpected client-side error occurred.',
      'Application error',
    );
  });

  it('usa mensaje genérico cuando el error es un string vacío', () => {
    // Un string en blanco no es un mensaje válido, debe usar el fallback.
    handler.handleError('   ');

    expect(mockNotifier.showMessage).toHaveBeenCalledWith(
      'An unexpected client-side error occurred.',
      'Application error',
    );
  });
});

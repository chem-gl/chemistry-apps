// global-error-modal.service.spec.ts: Pruebas unitarias del servicio global para mostrar errores en modal reutilizable.

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { GlobalErrorModalService } from './global-error-modal.service';

describe('GlobalErrorModalService', () => {
  let service: GlobalErrorModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GlobalErrorModalService);
  });

  it('stores a message and clears it on dismiss', () => {
    service.showMessage('Backend unavailable', 'Request failed');

    expect(service.currentError()).toEqual({
      title: 'Request failed',
      message: 'Backend unavailable',
      details: null,
    });

    service.dismiss();
    expect(service.currentError()).toBeNull();
  });

  it('maps HttpErrorResponse detail payload into modal view model', () => {
    const response = new HttpErrorResponse({
      status: 500,
      error: { detail: 'Server exploded' },
      statusText: 'Internal Server Error',
      url: '/api/jobs',
    });

    service.showHttpError(response);

    const currentError = service.currentError();
    expect(currentError).not.toBeNull();
    expect(currentError?.title).toBe('Request failed');
    expect(currentError?.message).toBe('Server exploded');
    expect(currentError?.details).toContain('Server exploded');
  });
});

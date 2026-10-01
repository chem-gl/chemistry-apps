// chunk-load-recovery.spec.ts: Verifica la recarga única ante chunks caídos.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChunkLoadRecovery } from './chunk-load-recovery';

describe('installChunkLoadRecovery', () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    reloadMock.mockReset();
    Object.defineProperty(globalThis, 'location', {
      value: { reload: reloadMock },
      configurable: true,
      writable: true,
    });
    installChunkLoadRecovery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('recarga ante un error de import dinámico', () => {
    globalThis.dispatchEvent(
      new ErrorEvent('error', {
        message: 'error loading dynamically imported module: /chunk-ABC.js',
      }),
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('recarga ante un unhandledrejection de import dinámico', () => {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('Failed to fetch dynamically imported module: /chunk-ABC.js');
    globalThis.dispatchEvent(event);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('no recarga con errores ajenos ni repite dentro del enfriamiento', () => {
    globalThis.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    expect(reloadMock).not.toHaveBeenCalled();

    globalThis.dispatchEvent(
      new ErrorEvent('error', {
        message: 'error loading dynamically imported module: /chunk-ABC.js',
      }),
    );
    globalThis.dispatchEvent(
      new ErrorEvent('error', {
        message: 'error loading dynamically imported module: /chunk-DEF.js',
      }),
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

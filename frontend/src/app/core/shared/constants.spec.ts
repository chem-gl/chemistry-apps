// constants.spec.ts: Pruebas unitarias para las constantes de configuración del frontend.
// Cubre las ramas de resolución de URL de API usando la función exportada.

import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './constants';

describe('resolveApiBaseUrl', () => {
  it('strips trailing slash from valid URL and returns it unchanged when hostnames match', () => {
    // Rama normal: URL válida, hostname local tanto en config como en browser.
    const result = resolveApiBaseUrl('http://localhost:8000/');
    expect(result).toBe('http://localhost:8000');
  });

  it('returns raw string when input is not a parseable URL', () => {
    // Cubre el bloque catch cuando new URL() lanza excepción.
    const result = resolveApiBaseUrl('not-a-valid-url');
    expect(result).toBe('not-a-valid-url');
  });

  it('returns configured URL unchanged when browser hostname is empty string', () => {
    // Cubre la rama browserHostname === '' → return early.
    const originalHostname = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: '' },
      configurable: true,
    });
    try {
      const result = resolveApiBaseUrl('http://localhost:8000');
      expect(result).toBe('http://localhost:8000');
    } finally {
      if (originalHostname) {
        Object.defineProperty(globalThis, 'location', originalHostname);
      }
    }
  });

  it('replaces hostname when localhost config is accessed from a remote host', () => {
    // Cubre rama configuredHostIsLocal && !currentHostIsLocal → reemplaza hostname.
    const originalHostname = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'myserver.internal' },
      configurable: true,
    });
    try {
      const result = resolveApiBaseUrl('http://localhost:8000');
      expect(result).toContain('myserver.internal');
    } finally {
      if (originalHostname) {
        Object.defineProperty(globalThis, 'location', originalHostname);
      }
    }
  });
});

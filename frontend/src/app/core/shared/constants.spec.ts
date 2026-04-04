// constants.spec.ts: Pruebas unitarias para las constantes de configuración del frontend.
// Cubre las ramas de resolución de URL de API y WebSocket usando las funciones exportadas.

import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl, resolveWebSocketBaseUrl } from './constants';

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

describe('resolveWebSocketBaseUrl', () => {
  it('converts http:// to ws://', () => {
    // Cubre rama startsWith('http://') → true.
    expect(resolveWebSocketBaseUrl('http://api.example.com:8000')).toBe(
      'ws://api.example.com:8000',
    );
  });

  it('converts https:// to wss://', () => {
    // Cubre rama startsWith('https://') → true.
    expect(resolveWebSocketBaseUrl('https://api.example.com')).toBe('wss://api.example.com');
  });

  it('returns raw URL when it does not use http or https', () => {
    // Cubre la rama fallback (ni http ni https).
    expect(resolveWebSocketBaseUrl('ws://raw.example.com')).toBe('ws://raw.example.com');
  });

  it('strips trailing slash before conversion', () => {
    // Verifica normalización del trailing slash antes de comparar protocolo.
    expect(resolveWebSocketBaseUrl('http://localhost:8000/')).toBe('ws://localhost:8000');
  });
});

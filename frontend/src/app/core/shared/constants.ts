// constants.ts: Constantes compartidas del frontend para configuracion de servicios

import { environment } from '../../../environments/environment';

const TRAILING_SLASH_PATTERN: RegExp = /\/+$/;

export function resolveApiBaseUrl(configuredApiBaseUrl: string): string {
  const normalizedConfiguredApiBaseUrl: string = configuredApiBaseUrl.replace(
    TRAILING_SLASH_PATTERN,
    '',
  );

  try {
    const resolvedApiUrl: URL = new URL(normalizedConfiguredApiBaseUrl);
    const browserHostname: string | undefined = globalThis.location?.hostname;

    if (browserHostname === undefined || browserHostname === '') {
      return normalizedConfiguredApiBaseUrl;
    }

    const configuredHostIsLocal: boolean =
      resolvedApiUrl.hostname === 'localhost' || resolvedApiUrl.hostname === '127.0.0.1';
    const currentHostIsLocal: boolean =
      browserHostname === 'localhost' || browserHostname === '127.0.0.1';

    if (configuredHostIsLocal && !currentHostIsLocal) {
      resolvedApiUrl.hostname = browserHostname;
    }

    return resolvedApiUrl.toString().replace(TRAILING_SLASH_PATTERN, '');
  } catch {
    return normalizedConfiguredApiBaseUrl;
  }
}

export const API_BASE_URL: string = resolveApiBaseUrl(environment.apiBaseUrl);

export function resolveWebSocketBaseUrl(apiBaseUrl: string): string {
  const normalizedApiBaseUrl: string = apiBaseUrl.replace(TRAILING_SLASH_PATTERN, '');

  if (normalizedApiBaseUrl.startsWith('https://')) {
    return normalizedApiBaseUrl.replace('https://', 'wss://');
  }

  if (normalizedApiBaseUrl.startsWith('http://')) {
    return normalizedApiBaseUrl.replace('http://', 'ws://');
  }

  return normalizedApiBaseUrl;
}

export const WEBSOCKET_BASE_URL: string = resolveWebSocketBaseUrl(API_BASE_URL);
export const JOBS_WEBSOCKET_URL: string = `${WEBSOCKET_BASE_URL}/ws/jobs/stream/`;

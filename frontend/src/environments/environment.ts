// environment.ts: Variables de entorno base para ejecucion local del frontend

import { FrontendEnvironment } from './environment.model';

export const environment: FrontendEnvironment = {
  production: false,
  apiBaseUrl: 'http://localhost:8000',
  appVersion: '1.0.0',
};

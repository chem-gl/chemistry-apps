// environment.ts: Variables de entorno base para ejecucion local del frontend

import { FrontendEnvironment } from './environment.model';

export const environment: FrontendEnvironment = {
  production: false,
  apiBaseUrl: 'https://back-apps.guzman-lopez.com',
  appVersion: '1.0.0',
};

// environment.production.ts: Variables de entorno para compilaciones de produccion

import { FrontendEnvironment } from './environment.model';

export const environment: FrontendEnvironment = {
  production: true,
  apiBaseUrl: 'http://localhost:8000',
};

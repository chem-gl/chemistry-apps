// environment.model.ts: Contrato tipado compartido para variables de entorno

export interface FrontendEnvironment {
  production: boolean;
  apiBaseUrl: string;
}

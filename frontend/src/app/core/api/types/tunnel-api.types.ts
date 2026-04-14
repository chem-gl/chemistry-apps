// tunnel-api.types.ts: Tipos de la app Tunnel (efecto túnel) para la capa API del frontend.
// Uso: importar cuando se necesiten parámetros de despacho o eventos de entrada de Tunnel.

/** Evento de modificación de una entrada de Tunnel capturado en UI */
export interface TunnelInputChangeEvent {
  fieldName: string;
  previousValue: number;
  newValue: number;
  changedAt: string;
}

/** Parámetros de entrada para crear un job de efecto túnel */
export interface TunnelParams {
  reactionBarrierZpe: number;
  imaginaryFrequency: number;
  reactionEnergyZpe: number;
  temperature: number;
  inputChangeEvents?: TunnelInputChangeEvent[];
  version?: string;
}

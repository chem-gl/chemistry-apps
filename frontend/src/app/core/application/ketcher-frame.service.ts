// ketcher-frame.service.ts: Servicio reutilizable para resolver y esperar la API de Ketcher desde iframes.

import { Injectable } from '@angular/core';

export type KetcherApi = {
  getSmiles: () => Promise<string>;
  setMolecule: (molecule: string) => Promise<void>;
};

@Injectable({ providedIn: 'root' })
export class KetcherFrameService {
  /**
   * Resuelve la API de Ketcher desde un iframe.
   * Retorna null cuando la API no está lista o el iframe no existe.
   */
  resolveApi(iframeElement: HTMLIFrameElement | null | undefined): KetcherApi | null {
    if (iframeElement === null || iframeElement === undefined) {
      return null;
    }

    const frameWindow: (Window & { ketcher?: unknown }) | null = iframeElement.contentWindow as
      | (Window & { ketcher?: unknown })
      | null;
    const maybeKetcherApi: unknown = frameWindow?.ketcher;

    if (
      typeof maybeKetcherApi !== 'object' ||
      maybeKetcherApi === null ||
      !('getSmiles' in maybeKetcherApi) ||
      !('setMolecule' in maybeKetcherApi)
    ) {
      return null;
    }

    return maybeKetcherApi as KetcherApi;
  }

  /**
   * Espera de forma activa hasta que Ketcher esté disponible.
   * Falla rápido si los parámetros de control son inválidos.
   */
  async waitForApi(
    iframeElement: HTMLIFrameElement | null | undefined,
    maxAttempts: number = 20,
    pollingMs: number = 50,
  ): Promise<KetcherApi | null> {
    if (maxAttempts <= 0) {
      throw new RangeError('maxAttempts must be greater than 0.');
    }
    if (pollingMs < 0) {
      throw new RangeError('pollingMs must be greater than or equal to 0.');
    }

    for (let attemptIndex: number = 0; attemptIndex < maxAttempts; attemptIndex++) {
      const ketcherApi: KetcherApi | null = this.resolveApi(iframeElement);
      if (ketcherApi !== null) {
        return ketcherApi;
      }

      if (pollingMs > 0) {
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, pollingMs));
      }
    }

    return null;
  }
}

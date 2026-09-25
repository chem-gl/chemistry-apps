// job-progress-text.service.ts: Texto de progreso de un job en el idioma activo de la UI.
// Combina el stage machine-readable del snapshot (`progress_stage`) con el catálogo Transloco
// (`progress.stage.*`), porque el backend redacta `progress_message` únicamente en español.

import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  ProgressSnapshotText,
  ProgressTextSource,
  resolveProgressMessage,
} from './progress-stage-messages';

@Injectable({ providedIn: 'root' })
export class JobProgressTextService implements ProgressTextSource {
  // Opcional: en SSR y en inyectores planos de prueba puede no haber catálogo i18n registrado.
  // En ese caso `resolve` degrada al mensaje del backend o al fallback propio de la app.
  private readonly translocoService = inject(TranslocoService, { optional: true });

  /** Mensaje legible para el snapshot actual, sin exponer texto sin traducir. */
  resolve(snapshot: ProgressSnapshotText | null, fallbackMessage: string): string {
    return resolveProgressMessage({
      stage: snapshot?.progress_stage,
      backendMessage: snapshot?.progress_message,
      fallbackMessage,
      // `activeLang()` es un signal: al leerlo dentro del computed de cada workflow, el texto se
      // recalcula cuando el usuario cambia de idioma, sin esperar un nuevo evento de progreso.
      activeLanguage: this.translocoService?.activeLang() ?? null,
      translate: (translationKey: string) => this.translocoService?.translate(translationKey) ?? null,
    });
  }
}

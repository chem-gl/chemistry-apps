// smiles-job-workflow.service.ts: Base intermedia para apps que procesan lotes de SMILES.
// Centraliza parseo de entrada, validación de compatibilidad y carga de logs históricos.
// SaScoreWorkflowService y ToxicityPropertiesWorkflowService extienden esta clase.

import { Injectable } from '@angular/core';
import {
  JobLogEntryView,
  JobLogsPageView,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

/**
 * Clase base compartida para workflows que reciben múltiples SMILES como entrada.
 * Provee parseo de texto SMILES, mensajes de error de compatibilidad y carga de logs con
 * ordenamiento por índice de evento.
 */
@Injectable()
export abstract class SmilesJobWorkflowService<
  TResultData,
> extends BaseJobWorkflowService<TResultData> {
  /**
   * Carga los logs históricos del job con un límite mayor y ordenados por eventIndex.
   * Sobrescribe el comportamiento base para apps de SMILES que generan más eventos de log.
   */
  protected override loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 300 }).subscribe({
      next: (logsPage: JobLogsPageView) => {
        const sortedLogs: JobLogEntryView[] = [...logsPage.results].sort(
          (leftLog: JobLogEntryView, rightLog: JobLogEntryView) =>
            leftLog.eventIndex - rightLog.eventIndex,
        );
        this.jobLogs.set(sortedLogs);
      },
      error: () => {
        this.jobLogs.set([]);
      },
    });
  }

  /**
   * Convierte texto multilínea de SMILES en arreglo de strings normalizados.
   * Elimina líneas vacías y espacios en blanco al inicio/fin de cada línea.
   */
  protected parseSmilesInput(rawInput: string): string[] {
    return rawInput
      .split(/\r?\n/)
      .map((smilesItem: string) => smilesItem.trim())
      .filter((smilesItem: string) => smilesItem.length > 0);
  }

  /**
   * Construye un mensaje de error legible cuando algunos SMILES no son compatibles.
   * Muestra hasta 3 ejemplos con sus razones y el conteo de problemas restantes.
   */
  protected buildSmilesCompatibilityErrorMessage(
    validationResult: SmilesCompatibilityResultView,
  ): string {
    const issuePreview: string = validationResult.issues
      .slice(0, 3)
      .map((issueItem) => `${issueItem.smiles} (${issueItem.reason})`)
      .join('; ');
    const overflowCount: number = Math.max(validationResult.issues.length - 3, 0);
    const overflowMessage: string = overflowCount > 0 ? `; +${overflowCount} more.` : '.';
    return `Some SMILES are not compatible and were not sent: ${issuePreview}${overflowMessage}`;
  }
}

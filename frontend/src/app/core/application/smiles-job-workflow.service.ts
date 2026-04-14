// smiles-job-workflow.service.ts: Base intermedia para apps que procesan lotes de SMILES.
// Centraliza parseo de entrada, validación de compatibilidad y carga de logs históricos.
// SaScoreWorkflowService y ToxicityPropertiesWorkflowService extienden esta clase.

import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  JobLogEntryView,
  JobLogsPageView,
  SmilesCompatibilityIssueView,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import {
  buildSmilesTextFromRows,
  NamedSmilesInputRow,
  parseNamedSmilesBatch,
} from '../shared/scientific-app-ui.utils';
import {
  extractScientificJobNameFromParameters,
  persistScientificJobName,
  resolveScientificJobNameCandidate,
  resolveScientificJobNameForHistory,
} from '../shared/scientific-job-name.utils';
import { BaseJobWorkflowService } from './base-job-workflow.service';

/**
 * Clase base compartida para workflows que reciben múltiples SMILES como entrada.
 * Provee parseo de texto SMILES, mensajes de error de compatibilidad y carga de logs con
 * ordenamiento por índice de evento.
 */
@Injectable()
export abstract class SmilesJobWorkflowService<TResultData>
  extends BaseJobWorkflowService<TResultData>
  implements OnDestroy
{
  readonly smilesInput = signal<string>('');
  readonly inputRows = signal<NamedSmilesInputRow[]>([]);
  readonly customNamesEnabled = signal<boolean>(false);
  readonly jobNameInput = signal<string>('');
  readonly currentJobDisplayName = signal<string | null>(null);
  readonly invalidSmilesIssues = signal<SmilesCompatibilityIssueView[]>([]);
  readonly isInputValidationPending = signal<boolean>(false);
  readonly resolvedJobName = computed<string | null>(() =>
    resolveScientificJobNameCandidate(this.jobNameInput(), this.inputRows()),
  );
  readonly hasInvalidSmiles = computed<boolean>(() => this.invalidSmilesIssues().length > 0);
  readonly inputValidationMessage = computed<string | null>(() => {
    const issues: SmilesCompatibilityIssueView[] = this.invalidSmilesIssues();
    if (issues.length === 0) {
      return null;
    }

    return this.buildSmilesCompatibilityErrorMessage({ compatible: false, issues });
  });

  private inputValidationSubscription: Subscription | null = null;
  private inputValidationTimer: ReturnType<typeof setTimeout> | null = null;
  private latestValidationToken: number = 0;

  protected constructor(initialInput: string) {
    super();
    this.applyParsedBatch(parseNamedSmilesBatch(initialInput), false);
  }

  protected abstract get workflowPluginName(): string;

  override ngOnDestroy(): void {
    this.inputValidationSubscription?.unsubscribe();
    if (this.inputValidationTimer !== null) {
      clearTimeout(this.inputValidationTimer);
    }
    super.ngOnDestroy();
  }

  override reset(): void {
    super.reset();
    this.currentJobDisplayName.set(null);
  }

  protected override prepareForDispatch(): void {
    super.prepareForDispatch();
    this.currentJobDisplayName.set(null);
  }

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
    return parseNamedSmilesBatch(rawInput).rows.map(
      (rowValue: NamedSmilesInputRow) => rowValue.smiles,
    );
  }

  setBatchInputText(rawInput: string): void {
    this.applyParsedBatch(parseNamedSmilesBatch(rawInput), true);
  }

  setInputRows(rows: NamedSmilesInputRow[], enableCustomNames: boolean = false): void {
    this.inputRows.set(rows);
    this.smilesInput.set(buildSmilesTextFromRows(rows));
    if (enableCustomNames || rows.some((rowValue) => rowValue.name !== rowValue.smiles)) {
      this.customNamesEnabled.set(true);
    }
    this.scheduleInputValidation(rows);
  }

  updateInputRowName(rowIndex: number, nextName: string): void {
    this.inputRows.update((currentRows: NamedSmilesInputRow[]) =>
      currentRows.map((rowValue: NamedSmilesInputRow, index: number) =>
        index === rowIndex ? { ...rowValue, name: nextName } : rowValue,
      ),
    );
  }

  protected buildNamedInputRows(): NamedSmilesInputRow[] {
    return this.inputRows()
      .map((rowValue: NamedSmilesInputRow) => ({
        name: rowValue.name.trim().length > 0 ? rowValue.name.trim() : rowValue.smiles,
        smiles: rowValue.smiles.trim(),
      }))
      .filter((rowValue: NamedSmilesInputRow) => rowValue.smiles.length > 0);
  }

  protected getPreDispatchSmilesValidationError(): string | null {
    if (this.isInputValidationPending()) {
      return 'Wait until SMILES validation finishes.';
    }

    return this.inputValidationMessage();
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
    return `Some SMILES are invalid or unsupported and were not sent: ${issuePreview}${overflowMessage}`;
  }

  protected rememberDispatchedJobDisplayName(jobId: string): void {
    const resolvedJobName: string | null = this.resolvedJobName();
    this.currentJobDisplayName.set(resolvedJobName);
    persistScientificJobName(this.workflowPluginName, jobId, resolvedJobName);
  }

  protected hydrateCurrentJobDisplayName(jobId: string, parameters: unknown): void {
    const resolvedJobName: string | null =
      resolveScientificJobNameForHistory(this.workflowPluginName, jobId, parameters) ??
      extractScientificJobNameFromParameters(parameters);
    this.currentJobDisplayName.set(resolvedJobName);
    persistScientificJobName(this.workflowPluginName, jobId, resolvedJobName);
  }

  private applyParsedBatch(
    parsedBatch: ReturnType<typeof parseNamedSmilesBatch>,
    shouldValidate: boolean,
  ): void {
    this.inputRows.set(parsedBatch.rows);
    this.smilesInput.set(buildSmilesTextFromRows(parsedBatch.rows));
    if (parsedBatch.containsExplicitNames) {
      this.customNamesEnabled.set(true);
    }
    if (shouldValidate) {
      this.scheduleInputValidation(parsedBatch.rows);
    }
  }

  private scheduleInputValidation(rows: NamedSmilesInputRow[]): void {
    const smilesList: string[] = rows
      .map((rowValue: NamedSmilesInputRow) => rowValue.smiles.trim())
      .filter((smilesValue: string) => smilesValue.length > 0);

    this.latestValidationToken += 1;
    const validationToken: number = this.latestValidationToken;

    if (this.inputValidationTimer !== null) {
      clearTimeout(this.inputValidationTimer);
      this.inputValidationTimer = null;
    }
    this.inputValidationSubscription?.unsubscribe();

    if (smilesList.length === 0) {
      this.invalidSmilesIssues.set([]);
      this.isInputValidationPending.set(false);
      return;
    }

    this.isInputValidationPending.set(true);
    this.inputValidationTimer = setTimeout(() => {
      this.inputValidationSubscription = this.jobsApiService
        .validateSmilesCompatibility(smilesList)
        .subscribe({
          next: (validationResult: SmilesCompatibilityResultView) => {
            if (validationToken !== this.latestValidationToken) {
              return;
            }
            this.invalidSmilesIssues.set(validationResult.issues);
            this.isInputValidationPending.set(false);
          },
          error: () => {
            if (validationToken !== this.latestValidationToken) {
              return;
            }
            this.invalidSmilesIssues.set([]);
            this.isInputValidationPending.set(false);
          },
        });
    }, 250);
  }
}

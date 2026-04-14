// sa-score-workflow.service.ts: Orquesta entrada, ejecución async, tabla de resultados y exportes CSV para SA Score.

import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DownloadedReportFile,
  SaScoreJobResponseView,
  SaScoreMethod,
  SaScoreMoleculeResultView,
  SaScoreParams,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import { SmilesJobWorkflowService } from './smiles-job-workflow.service';

export interface SaScoreResultData {
  molecules: SaScoreMoleculeResultView[];
  total: number;
  requestedMethods: SaScoreMethod[];
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class SaScoreWorkflowService extends SmilesJobWorkflowService<SaScoreResultData> {
  constructor() {
    super('CCO\nCC(=O)O\nc1ccccc1');
  }

  protected override get workflowPluginName(): string {
    return 'sa-score';
  }

  protected override get defaultProgressMessage(): string {
    return 'Preparing SA score calculation...';
  }

  readonly selectedMethods = signal<Record<SaScoreMethod, boolean>>({
    ambit: true,
    brsa: true,
    rdkit: true,
  });

  readonly selectedMethodList = computed<SaScoreMethod[]>(() => {
    const methodFlags: Record<SaScoreMethod, boolean> = this.selectedMethods();
    const enabledMethods: SaScoreMethod[] = [];

    if (methodFlags.ambit) {
      enabledMethods.push('ambit');
    }
    if (methodFlags.brsa) {
      enabledMethods.push('brsa');
    }
    if (methodFlags.rdkit) {
      enabledMethods.push('rdkit');
    }

    return enabledMethods;
  });

  override dispatch(): void {
    const preDispatchValidationError: string | null = this.getPreDispatchSmilesValidationError();
    if (preDispatchValidationError !== null) {
      this.activeSection.set('error');
      this.errorMessage.set(preDispatchValidationError);
      return;
    }

    this.prepareForDispatch();

    const normalizedRows = this.buildNamedInputRows();
    if (normalizedRows.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('At least one SMILES is required.');
      return;
    }

    const enabledMethods: SaScoreMethod[] = this.selectedMethodList();
    if (enabledMethods.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('Select at least one SA method (AMBIT, BRSA or RDKit).');
      return;
    }

    const dispatchParams: SaScoreParams = {
      molecules: normalizedRows,
      methods: enabledMethods,
      version: '1.0.0',
    };

    this.jobsApiService
      .validateSmilesCompatibility(normalizedRows.map((rowValue) => rowValue.smiles))
      .subscribe({
        next: (validationResult: SmilesCompatibilityResultView) => {
          if (!validationResult.compatible) {
            this.activeSection.set('error');
            this.errorMessage.set(this.buildSmilesCompatibilityErrorMessage(validationResult));
            return;
          }

          this.jobsApiService.dispatchSaScoreJob(dispatchParams).subscribe({
            next: (jobResponse: SaScoreJobResponseView) => {
              this.rememberDispatchedJobDisplayName(jobResponse.id);
              this.handleDispatchJobResponse(
                jobResponse,
                (job) => this.extractResultData(job),
                'SA score',
              );
            },
            error: (dispatchError: Error) => {
              this.activeSection.set('error');
              this.errorMessage.set(`Unable to create SA score job: ${dispatchError.message}`);
            },
          });
        },
        error: (validationError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(
            `Unable to validate SMILES compatibility: ${validationError.message}`,
          );
        },
      });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('sa-score');
  }

  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getSaScoreJobStatus(jobId).subscribe({
      next: (jobResponse: SaScoreJobResponseView) => {
        this.hydrateCurrentJobDisplayName(jobId, jobResponse.parameters);
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          loadHistoryAfter: false,
        });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  toggleMethod(method: SaScoreMethod): void {
    this.selectedMethods.update((currentFlags: Record<SaScoreMethod, boolean>) => ({
      ...currentFlags,
      [method]: !currentFlags[method],
    }));
  }

  downloadFullCsvReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadSaScoreCsvReport(this.currentJobId()!),
      'CSV report',
    );
  }

  downloadMethodCsvReport(method: SaScoreMethod): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadSaScoreCsvMethodReport(this.currentJobId()!, method),
      `${method.toUpperCase()} CSV report`,
    );
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getSaScoreJobStatus(jobId).subscribe({
      next: (jobResponse: SaScoreJobResponseView) => {
        this.hydrateCurrentJobDisplayName(jobId, jobResponse.parameters);
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          checkFailed: false,
          loadLogs: false,
        });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve final SA score result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: SaScoreJobResponseView): SaScoreResultData | null {
    const resultsPayload: unknown = jobResponse.results;
    if (
      resultsPayload === null ||
      typeof resultsPayload !== 'object' ||
      Array.isArray(resultsPayload)
    ) {
      return null;
    }

    const typedResults: {
      molecules?: unknown;
      total?: unknown;
      requested_methods?: unknown;
    } = resultsPayload as {
      molecules?: unknown;
      total?: unknown;
      requested_methods?: unknown;
    };

    if (!Array.isArray(typedResults.molecules) || !Array.isArray(typedResults.requested_methods)) {
      return null;
    }

    const normalizedMethods: SaScoreMethod[] = typedResults.requested_methods.filter(
      (methodItem: unknown): methodItem is SaScoreMethod =>
        methodItem === 'ambit' || methodItem === 'brsa' || methodItem === 'rdkit',
    );

    if (normalizedMethods.length === 0) {
      return null;
    }

    return {
      molecules: typedResults.molecules as SaScoreMoleculeResultView[],
      total:
        typeof typedResults.total === 'number' ? typedResults.total : typedResults.molecules.length,
      requestedMethods: normalizedMethods,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }
}

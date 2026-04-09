// toxicity-properties-workflow.service.ts: Orquesta entrada, ejecucion async,
// progreso, resultados y export CSV para Toxicity Properties Table.

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DownloadedReportFile,
  SmilesCompatibilityResultView,
  ToxicityJobResponseView,
  ToxicityMoleculeResultView,
} from '../api/jobs-api.service';
import { SmilesJobWorkflowService } from './smiles-job-workflow.service';

export interface ToxicityPropertiesResultData {
  molecules: ToxicityMoleculeResultView[];
  total: number;
  scientificReferences: string[];
}

@Injectable()
export class ToxicityPropertiesWorkflowService extends SmilesJobWorkflowService<ToxicityPropertiesResultData> {
  constructor() {
    super('CCO\nCC(=O)O\nc1ccccc1');
  }

  protected override get defaultProgressMessage(): string {
    return 'Preparing toxicity prediction...';
  }

  override dispatch(): void {
    this.prepareForDispatch();

    const normalizedRows = this.buildNamedInputRows();
    if (normalizedRows.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('At least one SMILES is required.');
      return;
    }

    this.jobsApiService
      .validateSmilesCompatibility(normalizedRows.map((rowValue) => rowValue.smiles))
      .subscribe({
        next: (validationResult: SmilesCompatibilityResultView) => {
          if (!validationResult.compatible) {
            this.activeSection.set('error');
            this.errorMessage.set(this.buildSmilesCompatibilityErrorMessage(validationResult));
            return;
          }

          this.jobsApiService
            .dispatchToxicityPropertiesJob({
              molecules: normalizedRows,
              version: '1.0.0',
            })
            .subscribe({
              next: (jobResponse: ToxicityJobResponseView) => {
                this.currentJobId.set(jobResponse.id);

                if (jobResponse.status === 'completed') {
                  const immediateResultData: ToxicityPropertiesResultData | null =
                    this.extractResultData(jobResponse);
                  if (immediateResultData === null) {
                    this.activeSection.set('error');
                    this.errorMessage.set(
                      'The completed job payload is invalid for toxicity properties.',
                    );
                    return;
                  }

                  this.resultData.set(immediateResultData);
                  this.loadHistoricalLogs(jobResponse.id);
                  this.activeSection.set('result');
                  this.loadHistory();
                  return;
                }

                this.activeSection.set('progress');
                this.startProgressStream(jobResponse.id);
              },
              error: (dispatchError: Error) => {
                this.activeSection.set('error');
                this.errorMessage.set(
                  `Unable to create toxicity properties job: ${dispatchError.message}`,
                );
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
    this.loadHistoryForPlugin('toxicity-properties');
  }

  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getToxicityPropertiesJobStatus(jobId).subscribe({
      next: (jobResponse: ToxicityJobResponseView) => {
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

  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadToxicityPropertiesCsvReport(this.currentJobId()!),
      'CSV report',
    );
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getToxicityPropertiesJobStatus(jobId).subscribe({
      next: (jobResponse: ToxicityJobResponseView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          checkFailed: false,
          loadLogs: false,
        });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve final toxicity result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(
    jobResponse: ToxicityJobResponseView,
  ): ToxicityPropertiesResultData | null {
    const resultsPayload = jobResponse.results;
    if (
      !Array.isArray(resultsPayload?.molecules) ||
      !Array.isArray(resultsPayload?.scientific_references)
    ) {
      return null;
    }
    return {
      molecules: resultsPayload.molecules,
      total: resultsPayload.total,
      scientificReferences: resultsPayload.scientific_references.filter(
        (referenceItem: string) => referenceItem.trim() !== '',
      ),
    };
  }
}

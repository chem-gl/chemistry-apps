// cadma-py-workflow.service.ts: Orquesta el formulario de candidatos y el ciclo async del job CADMA Py.

import { Injectable, inject, signal } from '@angular/core';
import { CadmaPyApiService, CadmaPyResultView } from '../api/cadma-py-api.service';
import { ScientificJobView } from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

const PAUSED_DRAFTS_STORAGE_KEY = 'chemistry-apps.cadma-py.paused-drafts.v1';

export interface CadmaPausedDraftView {
  id: string;
  referenceLibraryId: string;
  referenceLibraryName: string;
  projectLabel: string;
  combinedCsvText: string;
  smilesCsvText: string;
  toxicityCsvText: string;
  saCsvText: string;
  sourceConfigsJson: string;
  filenames: string[];
  totalFiles: number;
  totalUsableRows: number;
  savedAt: string;
  persistedInJobsMonitor: boolean;
}

@Injectable()
export class CadmaPyWorkflowService extends BaseJobWorkflowService<CadmaPyResultView> {
  private readonly cadmaApi = inject(CadmaPyApiService);

  readonly selectedReferenceLibraryId = signal<string>('');
  readonly projectLabel = signal<string>('');
  readonly combinedCsvText = signal<string>('');
  readonly smilesCsvText = signal<string>('');
  readonly toxicityCsvText = signal<string>('');
  readonly saCsvText = signal<string>('');
  readonly combinedFile = signal<File | null>(null);
  readonly smilesFile = signal<File | null>(null);
  readonly toxicityFile = signal<File | null>(null);
  readonly saFile = signal<File | null>(null);
  readonly sourceConfigsJson = signal<string>('');
  readonly pausedDrafts = signal<CadmaPausedDraftView[]>([]);
  readonly resumedDraftId = signal<string>('');

  constructor() {
    super();
    this.loadPausedDrafts();
  }

  protected override get defaultProgressMessage(): string {
    return 'Preparing CADMA Py comparison...';
  }

  override dispatch(): void {
    this.prepareForDispatch();

    if (this.selectedReferenceLibraryId().trim() === '') {
      this.activeSection.set('error');
      this.errorMessage.set('Select a reference family before running the comparison.');
      return;
    }

    if (this.projectLabel().trim() === '') {
      this.activeSection.set('error');
      this.errorMessage.set('Project label is required before running CADMA Py.');
      return;
    }

    const hasAnyCandidateSource =
      [
        this.combinedCsvText(),
        this.smilesCsvText(),
        this.toxicityCsvText(),
        this.saCsvText(),
        this.sourceConfigsJson(),
      ].some((value) => value.trim() !== '') ||
      [this.combinedFile(), this.smilesFile(), this.toxicityFile(), this.saFile()].some(
        (value) => value !== null,
      );

    if (!hasAnyCandidateSource) {
      this.activeSection.set('error');
      this.errorMessage.set('Upload at least one candidate CSV file before running CADMA Py.');
      return;
    }

    this.cadmaApi
      .createComparisonJob({
        reference_library_id: this.selectedReferenceLibraryId(),
        project_label: this.projectLabel().trim(),
        combined_csv_text: this.combinedCsvText(),
        smiles_csv_text: this.smilesCsvText(),
        toxicity_csv_text: this.toxicityCsvText(),
        sa_csv_text: this.saCsvText(),
        combined_file: this.combinedFile(),
        smiles_file: this.smilesFile(),
        toxicity_file: this.toxicityFile(),
        sa_file: this.saFile(),
        source_configs_json: this.sourceConfigsJson(),
      })
      .subscribe({
        next: (jobResponse: ScientificJobView) => {
          if (this.resumedDraftId().trim() !== '') {
            this.deletePausedDraft(this.resumedDraftId());
          }
          this.handleDispatchJobResponse(
            jobResponse,
            (job) => this.extractResultData(job),
            'CADMA Py',
          );
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(`Unable to create CADMA Py job: ${dispatchError.message}`);
        },
      });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('cadma-py');
  }

  openHistoricalJob(jobId: string): void {
    this.resumedDraftId.set('');
    this.currentJobId.set(jobId);
    this.activeSection.set('progress');
    this.errorMessage.set(null);
    this.resultData.set(null);
    this.fetchFinalResult(jobId);
  }

  savePausedDraft(
    payload: Omit<CadmaPausedDraftView, 'id' | 'savedAt' | 'persistedInJobsMonitor'>,
    persistedDraftId?: string,
  ): CadmaPausedDraftView {
    const normalizedPersistedId = persistedDraftId?.trim() ?? '';
    const nextDraft: CadmaPausedDraftView = {
      ...payload,
      id:
        normalizedPersistedId.length > 0
          ? normalizedPersistedId
          : this.resumedDraftId().trim() || this.buildDraftId(),
      savedAt: new Date().toISOString(),
      persistedInJobsMonitor: normalizedPersistedId.length > 0,
    };

    this.pausedDrafts.set(
      this.sortPausedDraftsBySavedAt([
        nextDraft,
        ...this.pausedDrafts().filter((draft) => draft.id !== nextDraft.id),
      ]),
    );
    this.resumedDraftId.set(nextDraft.id);
    this.persistPausedDrafts();
    this.activeSection.set('idle');
    this.errorMessage.set(null);
    return nextDraft;
  }

  resumePausedDraft(draftId: string): CadmaPausedDraftView | null {
    const draft = this.pausedDrafts().find((savedDraft) => savedDraft.id === draftId) ?? null;
    if (draft === null) {
      return null;
    }

    this.selectedReferenceLibraryId.set(draft.referenceLibraryId);
    this.projectLabel.set(draft.projectLabel);
    this.combinedCsvText.set(draft.combinedCsvText);
    this.smilesCsvText.set(draft.smilesCsvText);
    this.toxicityCsvText.set(draft.toxicityCsvText);
    this.saCsvText.set(draft.saCsvText);
    this.combinedFile.set(null);
    this.smilesFile.set(null);
    this.toxicityFile.set(null);
    this.saFile.set(null);
    this.sourceConfigsJson.set(
      draft.sourceConfigsJson.trim() === ''
        ? this.buildHistoricalSourceConfigsJson()
        : draft.sourceConfigsJson,
    );
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.resultData.set(null);
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.activeSection.set('idle');
    this.resumedDraftId.set(draft.id);
    return draft;
  }

  deletePausedDraft(draftId: string): void {
    const matchingDraft =
      this.pausedDrafts().find((savedDraft) => savedDraft.id === draftId) ?? null;

    this.pausedDrafts.update((savedDrafts) =>
      savedDrafts.filter((savedDraft) => savedDraft.id !== draftId),
    );
    if (this.resumedDraftId() === draftId) {
      this.resumedDraftId.set('');
    }
    this.persistPausedDrafts();

    if (matchingDraft?.persistedInJobsMonitor === true && this.looksLikePersistedJobId(draftId)) {
      this.jobsApiService.deleteJob(draftId).subscribe({
        next: () => this.loadHistory(),
        error: () => {
          // Ignorar inconsistencias transitorias entre la UI local y el historial remoto.
        },
      });
    }
  }

  clearCandidateInputs(): void {
    this.combinedCsvText.set('');
    this.smilesCsvText.set('');
    this.toxicityCsvText.set('');
    this.saCsvText.set('');
    this.combinedFile.set(null);
    this.smilesFile.set(null);
    this.toxicityFile.set(null);
    this.saFile.set(null);
    this.sourceConfigsJson.set('');
  }

  private loadPausedDrafts(): void {
    this.pausedDrafts.set(this.readPausedDraftsFromStorage());
  }

  private persistPausedDrafts(): void {
    if (globalThis.localStorage === undefined) {
      return;
    }

    try {
      globalThis.localStorage.setItem(
        PAUSED_DRAFTS_STORAGE_KEY,
        JSON.stringify(this.pausedDrafts()),
      );
    } catch {
      // Si el navegador bloquea localStorage, mantener el flujo sin persistencia local.
    }
  }

  private readPausedDraftsFromStorage(): CadmaPausedDraftView[] {
    if (globalThis.localStorage === undefined) {
      return [];
    }

    try {
      const rawValue = globalThis.localStorage.getItem(PAUSED_DRAFTS_STORAGE_KEY);
      if (rawValue === null || rawValue.trim() === '') {
        return [];
      }
      const parsedValue: unknown = JSON.parse(rawValue);
      if (!Array.isArray(parsedValue)) {
        return [];
      }

      return this.sortPausedDraftsBySavedAt(
        parsedValue.flatMap((draftValue) => {
          const normalizedDraft = this.normalizePausedDraft(draftValue);
          return normalizedDraft === null ? [] : [normalizedDraft];
        }),
      );
    } catch {
      return [];
    }
  }

  private normalizePausedDraft(value: unknown): CadmaPausedDraftView | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const filenames = Array.isArray(value['filenames'])
      ? value['filenames'].filter((item): item is string => typeof item === 'string')
      : [];

    return {
      id: this.readStringField(value['id']).trim(),
      referenceLibraryId: this.readStringField(value['referenceLibraryId']).trim(),
      referenceLibraryName: this.readStringField(value['referenceLibraryName']).trim(),
      projectLabel: this.readStringField(value['projectLabel']).trim(),
      combinedCsvText: this.readStringField(value['combinedCsvText']),
      smilesCsvText: this.readStringField(value['smilesCsvText']),
      toxicityCsvText: this.readStringField(value['toxicityCsvText']),
      saCsvText: this.readStringField(value['saCsvText']),
      sourceConfigsJson: this.readStringField(value['sourceConfigsJson']),
      filenames,
      totalFiles: this.readNumberField(value['totalFiles'], filenames.length),
      totalUsableRows: this.readNumberField(value['totalUsableRows'], 0),
      savedAt: this.readStringField(value['savedAt']) || new Date(0).toISOString(),
      persistedInJobsMonitor: this.readBooleanField(value['persistedInJobsMonitor'], false),
    };
  }

  private sortPausedDraftsBySavedAt(drafts: CadmaPausedDraftView[]): CadmaPausedDraftView[] {
    return [...drafts].sort(
      (leftDraft, rightDraft) =>
        new Date(rightDraft.savedAt).getTime() - new Date(leftDraft.savedAt).getTime(),
    );
  }

  private readStringField(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private readNumberField(value: unknown, fallbackValue: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue;
  }

  private readBooleanField(value: unknown, fallbackValue: boolean): boolean {
    return typeof value === 'boolean' ? value : fallbackValue;
  }

  private buildDraftId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cadma-draft-${Date.now()}`;
  }

  private looksLikePersistedJobId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    );
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.rehydrateHistoricalInputs(jobResponse);

        if (jobResponse.status === 'paused') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('idle');
          this.errorMessage.set(null);
          this.loadHistory();
          return;
        }

        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          loadLogs: false,
          loadHistoryAfter: true,
        });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve CADMA Py result: ${statusError.message}`);
      },
    });
  }

  private rehydrateHistoricalInputs(jobResponse: ScientificJobView): void {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return;
    }

    this.selectedReferenceLibraryId.set(
      this.readStringField(rawParameters['reference_library_id']),
    );
    this.projectLabel.set(this.readStringField(rawParameters['project_label']));
    this.combinedCsvText.set(this.readStringField(rawParameters['combined_csv_text']));
    this.smilesCsvText.set(this.readStringField(rawParameters['smiles_csv_text']));
    this.toxicityCsvText.set(this.readStringField(rawParameters['toxicity_csv_text']));
    this.saCsvText.set(this.readStringField(rawParameters['sa_csv_text']));
    this.combinedFile.set(null);
    this.smilesFile.set(null);
    this.toxicityFile.set(null);
    this.saFile.set(null);

    const persistedConfigs = this.readStringField(rawParameters['source_configs_json']).trim();
    this.sourceConfigsJson.set(
      persistedConfigs === '' ? this.buildHistoricalSourceConfigsJson() : persistedConfigs,
    );
  }

  private buildHistoricalSourceConfigsJson(): string {
    const historicalSources = [
      ['historical-combined.csv', this.combinedCsvText()],
      ['historical-smiles.csv', this.smilesCsvText()],
      ['historical-toxicity.csv', this.toxicityCsvText()],
      ['historical-sa.csv', this.saCsvText()],
    ]
      .filter(([, contentText]) => contentText.trim() !== '')
      .map(([filename, content_text]) => ({ filename, content_text, file_format: 'csv' }));

    return historicalSources.length > 0 ? JSON.stringify(historicalSources) : '';
  }

  private extractResultData(jobResponse: ScientificJobView): CadmaPyResultView | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const ranking = rawResults['ranking'];
    const metricCharts = rawResults['metric_charts'];
    const scoreChart = rawResults['score_chart'];

    if (!Array.isArray(ranking) || !Array.isArray(metricCharts) || !this.isRecord(scoreChart)) {
      return null;
    }

    return rawResults as unknown as CadmaPyResultView;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

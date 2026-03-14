// easy-rate-workflow.service.ts: Orquesta formulario multipart, progreso y resultados de la app Easy-rate.
// Gestiona señales de archivos Gaussian, parámetros cinéticos y el ciclo de vida del job asíncrono.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateInspectionExecutionView,
  EasyRateJobResponseView,
  EasyRateParams,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';

/** Secciones de pantalla activas durante el ciclo de vida del job */
type EasyRateSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

type EasyRateInspectionMap = Record<EasyRateInputFieldName, EasyRateFileInspectionView | null>;
type EasyRateInspectionLoadingMap = Record<EasyRateInputFieldName, boolean>;
type EasyRateInspectionErrorMap = Record<EasyRateInputFieldName, string | null>;
type EasyRateExecutionSelectionMap = Record<EasyRateInputFieldName, number | null>;

const EASY_RATE_FIELD_LABELS: Record<EasyRateInputFieldName, string> = {
  transition_state_file: 'Transition State',
  reactant_1_file: 'Reactant 1',
  reactant_2_file: 'Reactant 2',
  product_1_file: 'Product 1',
  product_2_file: 'Product 2',
};

function buildEasyRateFieldRecord<T>(createValue: () => T): Record<EasyRateInputFieldName, T> {
  return {
    transition_state_file: createValue(),
    reactant_1_file: createValue(),
    reactant_2_file: createValue(),
    product_1_file: createValue(),
    product_2_file: createValue(),
  };
}

/** Descriptor compacto de archivo de entrada para presentación en UI */
export interface EasyRateFileDescriptor {
  fieldName: string;
  originalFilename: string;
  sizeBytes: number;
}

/** Resultado mapeado de Easy-rate para consumo en la vista */
export interface EasyRateResultData {
  title: string;
  // Constantes de velocidad
  rateConstant: number | null;
  rateConstantTst: number | null;
  rateConstantDiffusionCorrected: number | null;
  kDiff: number | null;
  // Termodinámica (kcal/mol)
  gibbsReactionKcalMol: number;
  gibbsActivationKcalMol: number;
  enthalpyReactionKcalMol: number;
  enthalpyActivationKcalMol: number;
  zpeReactionKcalMol: number;
  zpeActivationKcalMol: number;
  // Corrección por túnel
  tunnelU: number | null;
  tunnelAlpha1: number | null;
  tunnelAlpha2: number | null;
  tunnelG: number | null;
  kappaTst: number;
  // Parámetros de condiciones de cálculo
  temperatureK: number;
  imaginaryFrequencyCm1: number;
  reactionPathDegeneracy: number;
  // Flags de resultado
  warnNegativeActivation: boolean;
  cageEffectsApplied: boolean;
  diffusionApplied: boolean;
  solventUsed: string;
  viscosityPaS: number | null;
  // Archivos de entrada persistidos
  fileDescriptors: EasyRateFileDescriptor[];
  // Estado histórico
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

/** Opciones de solvente disponibles para el formulario */
export const SOLVENT_OPTIONS: ReadonlyArray<string> = [
  'Gas phase (Air)',
  'Benzene',
  'Pentyl ethanoate',
  'Water',
  'Other',
];

@Injectable()
export class EasyRateWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;
  private readonly inspectionSubscriptions = new Map<EasyRateInputFieldName, Subscription>();

  // ── Señales de archivos de entrada ────────────────────────────────
  readonly transitionStateFile = signal<File | null>(null);
  readonly reactant1File = signal<File | null>(null);
  readonly reactant2File = signal<File | null>(null);
  readonly product1File = signal<File | null>(null);
  readonly product2File = signal<File | null>(null);
  readonly inputInspections = signal<EasyRateInspectionMap>(buildEasyRateFieldRecord(() => null));
  readonly inspectionLoading = signal<EasyRateInspectionLoadingMap>(
    buildEasyRateFieldRecord(() => false),
  );
  readonly inspectionErrorMessages = signal<EasyRateInspectionErrorMap>(
    buildEasyRateFieldRecord(() => null),
  );
  readonly selectedExecutionIndices = signal<EasyRateExecutionSelectionMap>(
    buildEasyRateFieldRecord(() => null),
  );

  // ── Señales de parámetros de cálculo ──────────────────────────────
  readonly title = signal<string>('');
  readonly reactionPathDegeneracy = signal<number>(1);
  readonly cageEffects = signal<boolean>(false);
  readonly diffusion = signal<boolean>(false);
  readonly solvent = signal<string>('Gas phase (Air)');
  readonly customViscosity = signal<number | null>(null);
  readonly radiusReactant1 = signal<number | null>(null);
  readonly radiusReactant2 = signal<number | null>(null);
  readonly reactionDistance = signal<number | null>(null);
  readonly printDataInput = signal<boolean>(false);

  // ── Estado del flujo ──────────────────────────────────────────────
  readonly activeSection = signal<EasyRateSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<EasyRateResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  // ── Señales derivadas ─────────────────────────────────────────────
  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );
  readonly canDispatch = computed(
    () => this.validateBeforeDispatch() === null && !this.isProcessing(),
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing Easy-rate job...',
  );
  readonly showDiffusionFields = computed(() => this.diffusion());
  readonly showCustomViscosity = computed(() => this.solvent() === 'Other');

  // ── Actualizadores de archivos ────────────────────────────────────
  updateTransitionStateFile(file: File | null): void {
    this.updateInputFile('transition_state_file', file);
  }
  updateReactant1File(file: File | null): void {
    this.updateInputFile('reactant_1_file', file);
  }
  updateReactant2File(file: File | null): void {
    this.updateInputFile('reactant_2_file', file);
  }
  updateProduct1File(file: File | null): void {
    this.updateInputFile('product_1_file', file);
  }
  updateProduct2File(file: File | null): void {
    this.updateInputFile('product_2_file', file);
  }

  updateInputFile(fieldName: EasyRateInputFieldName, file: File | null): void {
    this.setInputFile(fieldName, file);
    this.resetInspectionState(fieldName);
    this.errorMessage.set(null);

    if (file === null) {
      return;
    }

    this.inspectInputFile(fieldName, file);
  }

  updateSelectedExecutionIndex(
    fieldName: EasyRateInputFieldName,
    executionIndex: number | null,
  ): void {
    this.selectedExecutionIndices.update((currentSelections: EasyRateExecutionSelectionMap) => ({
      ...currentSelections,
      [fieldName]: executionIndex,
    }));
  }

  getInputFile(fieldName: EasyRateInputFieldName): File | null {
    if (fieldName === 'transition_state_file') {
      return this.transitionStateFile();
    }
    if (fieldName === 'reactant_1_file') {
      return this.reactant1File();
    }
    if (fieldName === 'reactant_2_file') {
      return this.reactant2File();
    }
    if (fieldName === 'product_1_file') {
      return this.product1File();
    }
    return this.product2File();
  }

  getInspection(fieldName: EasyRateInputFieldName): EasyRateFileInspectionView | null {
    return this.inputInspections()[fieldName];
  }

  isInspectionPending(fieldName: EasyRateInputFieldName): boolean {
    return this.inspectionLoading()[fieldName];
  }

  getInspectionError(fieldName: EasyRateInputFieldName): string | null {
    return this.inspectionErrorMessages()[fieldName];
  }

  getSelectedExecutionIndex(fieldName: EasyRateInputFieldName): number | null {
    return this.selectedExecutionIndices()[fieldName];
  }

  getSelectedInspectionExecution(
    fieldName: EasyRateInputFieldName,
  ): EasyRateInspectionExecutionView | null {
    const inspection = this.getInspection(fieldName);
    const selectedExecutionIndex = this.getSelectedExecutionIndex(fieldName);

    if (inspection === null || selectedExecutionIndex === null) {
      return null;
    }

    return (
      inspection.executions.find(
        (execution: EasyRateInspectionExecutionView) =>
          execution.executionIndex === selectedExecutionIndex,
      ) ?? null
    );
  }

  // ── Actualizadores de parámetros ──────────────────────────────────
  updateTitle(value: string): void {
    this.title.set(value);
  }
  updateReactionPathDegeneracy(value: number): void {
    this.reactionPathDegeneracy.set(value);
  }
  updateCageEffects(value: boolean): void {
    this.cageEffects.set(value);
  }
  updateDiffusion(value: boolean): void {
    this.diffusion.set(value);
    if (!value) {
      this.radiusReactant1.set(null);
      this.radiusReactant2.set(null);
      this.reactionDistance.set(null);
    }
  }
  updateSolvent(value: string): void {
    this.solvent.set(value);
    if (value !== 'Other') {
      this.customViscosity.set(null);
    }
  }
  updateCustomViscosity(value: number | null): void {
    this.customViscosity.set(value);
  }
  updateRadiusReactant1(value: number | null): void {
    this.radiusReactant1.set(value);
  }
  updateRadiusReactant2(value: number | null): void {
    this.radiusReactant2.set(value);
  }
  updateReactionDistance(value: number | null): void {
    this.reactionDistance.set(value);
  }
  updatePrintDataInput(value: boolean): void {
    this.printDataInput.set(value);
  }

  /** Despacha el job Easy-rate al backend usando los archivos y parámetros actuales */
  dispatch(): void {
    const validationError: string | null = this.validateBeforeDispatch();
    if (validationError !== null) {
      this.errorMessage.set(validationError);
      return;
    }

    const tsFile: File = this.transitionStateFile() as File;
    const reactant1File: File = this.reactant1File() as File;
    const reactant2File: File = this.reactant2File() as File;

    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const params: EasyRateParams = {
      transitionStateFile: tsFile,
      reactant1File,
      reactant2File,
      product1File: this.product1File() ?? undefined,
      product2File: this.product2File() ?? undefined,
      transitionStateExecutionIndex:
        this.selectedExecutionIndices().transition_state_file ?? undefined,
      reactant1ExecutionIndex: this.selectedExecutionIndices().reactant_1_file ?? undefined,
      reactant2ExecutionIndex: this.selectedExecutionIndices().reactant_2_file ?? undefined,
      product1ExecutionIndex: this.selectedExecutionIndices().product_1_file ?? undefined,
      product2ExecutionIndex: this.selectedExecutionIndices().product_2_file ?? undefined,
      title: this.title() || undefined,
      reactionPathDegeneracy: this.reactionPathDegeneracy(),
      cageEffects: this.cageEffects(),
      diffusion: this.diffusion(),
      solvent: this.solvent(),
      customViscosity: this.customViscosity() ?? undefined,
      radiusReactant1: this.radiusReactant1() ?? undefined,
      radiusReactant2: this.radiusReactant2() ?? undefined,
      reactionDistance: this.reactionDistance() ?? undefined,
      printDataInput: this.printDataInput(),
    };

    this.jobsApiService.dispatchEasyRateJob(params).subscribe({
      next: (jobResponse: EasyRateJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResult: EasyRateResultData | null = this.extractResultData(jobResponse);
          if (immediateResult === null) {
            this.activeSection.set('error');
            this.errorMessage.set('Job completed immediately but payload is invalid.');
            return;
          }
          this.resultData.set(immediateResult);
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
        this.errorMessage.set(`Unable to create Easy-rate job: ${dispatchError.message}`);
      },
    });
  }

  private validateBeforeDispatch(): string | null {
    const hasReactant1: boolean = this.reactant1File() !== null;
    const hasReactant2: boolean = this.reactant2File() !== null;
    const hasTransitionState: boolean = this.transitionStateFile() !== null;
    const hasAtLeastOneProduct: boolean =
      this.product1File() !== null || this.product2File() !== null;

    if (!hasReactant1) {
      return 'Reactant 1 file is required.';
    }
    if (!hasReactant2) {
      return 'Reactant 2 file is required.';
    }
    if (!hasTransitionState) {
      return 'Transition state file is required.';
    }
    if (!hasAtLeastOneProduct) {
      return 'At least one product file is required.';
    }

    const reactant1Validation = this.validateInspectedFile('reactant_1_file');
    if (reactant1Validation !== null) {
      return reactant1Validation;
    }

    const reactant2Validation = this.validateInspectedFile('reactant_2_file');
    if (reactant2Validation !== null) {
      return reactant2Validation;
    }

    const transitionStateValidation = this.validateInspectedFile('transition_state_file');
    if (transitionStateValidation !== null) {
      return transitionStateValidation;
    }

    if (this.product1File() !== null) {
      const product1Validation = this.validateInspectedFile('product_1_file');
      if (product1Validation !== null) {
        return product1Validation;
      }
    }

    if (this.product2File() !== null) {
      const product2Validation = this.validateInspectedFile('product_2_file');
      if (product2Validation !== null) {
        return product2Validation;
      }
    }

    return null;
  }

  /** Resetea el formulario de ejecución sin borrar los archivos cargados */
  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('idle');
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.resultData.set(null);
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
  }

  /** Limpia todos los archivos seleccionados del formulario */
  clearFiles(): void {
    this.transitionStateFile.set(null);
    this.reactant1File.set(null);
    this.reactant2File.set(null);
    this.product1File.set(null);
    this.product2File.set(null);
    this.resetAllInspectionState();
  }

  /** Abre y reconstruye la vista de un job histórico por su UUID */
  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getEasyRateJobStatus(jobId).subscribe({
      next: (jobResponse: EasyRateJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(
            jobResponse.error_trace ?? 'Historical Easy-rate job ended with error.',
          );
          return;
        }

        const historicalData: EasyRateResultData | null =
          this.extractResultData(jobResponse) ?? this.buildSummaryData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical Easy-rate job output.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  /** Recarga el historial de jobs Easy-rate del servidor */
  loadHistory(): void {
    this.isHistoryLoading.set(true);
    this.jobsApiService.listJobs({ pluginName: 'easy-rate' }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        const orderedJobs: ScientificJobView[] = [...jobItems].sort(
          (a: ScientificJobView, b: ScientificJobView) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
        this.historyJobs.set(orderedJobs);
        this.isHistoryLoading.set(false);
      },
      error: () => {
        this.isHistoryLoading.set(false);
      },
    });
  }

  /** Descarga el reporte CSV del job activo */
  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadEasyRateCsvReport(this.currentJobId()!),
      'CSV',
    );
  }

  /** Descarga el reporte LOG del job activo */
  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadEasyRateLogReport(this.currentJobId()!),
      'LOG',
    );
  }

  /** Descarga el reporte de error del job activo */
  downloadErrorReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadEasyRateErrorReport(this.currentJobId()!),
      'error report',
    );
  }

  /** Descarga el ZIP de archivos de entrada del job activo */
  downloadInputsZip(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadEasyRateInputsZip(this.currentJobId()!),
      'inputs ZIP',
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.inspectionSubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.inspectionSubscriptions.clear();
  }

  private setInputFile(fieldName: EasyRateInputFieldName, file: File | null): void {
    if (fieldName === 'transition_state_file') {
      this.transitionStateFile.set(file);
      return;
    }
    if (fieldName === 'reactant_1_file') {
      this.reactant1File.set(file);
      return;
    }
    if (fieldName === 'reactant_2_file') {
      this.reactant2File.set(file);
      return;
    }
    if (fieldName === 'product_1_file') {
      this.product1File.set(file);
      return;
    }
    this.product2File.set(file);
  }

  private inspectInputFile(fieldName: EasyRateInputFieldName, file: File): void {
    this.inspectionLoading.update((currentLoading: EasyRateInspectionLoadingMap) => ({
      ...currentLoading,
      [fieldName]: true,
    }));
    this.inspectionErrorMessages.update((currentErrors: EasyRateInspectionErrorMap) => ({
      ...currentErrors,
      [fieldName]: null,
    }));

    this.inspectionSubscriptions.get(fieldName)?.unsubscribe();
    const inspectionSubscription = this.jobsApiService
      .inspectEasyRateInput(fieldName, file)
      .pipe(
        finalize(() => {
          this.inspectionLoading.update((currentLoading: EasyRateInspectionLoadingMap) => ({
            ...currentLoading,
            [fieldName]: false,
          }));
        }),
      )
      .subscribe({
        next: (inspection: EasyRateFileInspectionView) => {
          this.inputInspections.update((currentInspections: EasyRateInspectionMap) => ({
            ...currentInspections,
            [fieldName]: inspection,
          }));
          this.selectedExecutionIndices.update(
            (currentSelections: EasyRateExecutionSelectionMap) => ({
              ...currentSelections,
              [fieldName]: inspection.defaultExecutionIndex,
            }),
          );
        },
        error: (inspectionError: Error) => {
          this.inspectionErrorMessages.update((currentErrors: EasyRateInspectionErrorMap) => ({
            ...currentErrors,
            [fieldName]: `Unable to inspect Gaussian file: ${inspectionError.message}`,
          }));
        },
      });

    this.inspectionSubscriptions.set(fieldName, inspectionSubscription);
  }

  private resetInspectionState(fieldName: EasyRateInputFieldName): void {
    this.inspectionSubscriptions.get(fieldName)?.unsubscribe();
    this.inspectionSubscriptions.delete(fieldName);
    this.inputInspections.update((currentInspections: EasyRateInspectionMap) => ({
      ...currentInspections,
      [fieldName]: null,
    }));
    this.inspectionLoading.update((currentLoading: EasyRateInspectionLoadingMap) => ({
      ...currentLoading,
      [fieldName]: false,
    }));
    this.inspectionErrorMessages.update((currentErrors: EasyRateInspectionErrorMap) => ({
      ...currentErrors,
      [fieldName]: null,
    }));
    this.selectedExecutionIndices.update((currentSelections: EasyRateExecutionSelectionMap) => ({
      ...currentSelections,
      [fieldName]: null,
    }));
  }

  private resetAllInspectionState(): void {
    this.inspectionSubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.inspectionSubscriptions.clear();
    this.inputInspections.set(buildEasyRateFieldRecord(() => null));
    this.inspectionLoading.set(buildEasyRateFieldRecord(() => false));
    this.inspectionErrorMessages.set(buildEasyRateFieldRecord(() => null));
    this.selectedExecutionIndices.set(buildEasyRateFieldRecord(() => null));
  }

  private validateInspectedFile(fieldName: EasyRateInputFieldName): string | null {
    const fieldLabel = EASY_RATE_FIELD_LABELS[fieldName];

    if (this.isInspectionPending(fieldName)) {
      return `${fieldLabel} is still being analyzed.`;
    }

    const inspectionError = this.getInspectionError(fieldName);
    if (inspectionError !== null) {
      return `${fieldLabel}: ${inspectionError}`;
    }

    const inspection = this.getInspection(fieldName);
    if (inspection === null) {
      return `${fieldLabel} has not been inspected yet.`;
    }

    if (inspection.executionCount === 0) {
      return `${fieldLabel} does not contain any valid Gaussian execution.`;
    }

    const selectedExecutionIndex = this.getSelectedExecutionIndex(fieldName);
    if (selectedExecutionIndex === null) {
      return `Select a parsed execution for ${fieldLabel}.`;
    }

    const selectedExecution = this.getSelectedInspectionExecution(fieldName);
    if (selectedExecution === null) {
      return `Selected execution is no longer available for ${fieldLabel}.`;
    }

    if (!selectedExecution.isValidForRole) {
      return `${fieldLabel}: ${selectedExecution.validationErrors.join(' ')}`;
    }

    return null;
  }

  private buildDownloadStream(
    source: Observable<DownloadedReportFile>,
    label: string,
  ): Observable<DownloadedReportFile> {
    if (this.currentJobId() === null) {
      throw new Error('No job selected for download.');
    }
    this.exportErrorMessage.set(null);
    this.isExporting.set(true);
    return source.pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const msg: string = requestError instanceof Error ? requestError.message : 'Unknown error.';
        this.exportErrorMessage.set(`Unable to download ${label}: ${msg}`);
        return throwError(() => requestError);
      }),
    );
  }

  private startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();
    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.jobLogs.update((currentLogs: JobLogEntryView[]) => {
          if (
            currentLogs.some((item: JobLogEntryView) => item.eventIndex === logEntry.eventIndex)
          ) {
            return currentLogs;
          }
          return [...currentLogs, logEntry].sort(
            (a: JobLogEntryView, b: JobLogEntryView) => a.eventIndex - b.eventIndex,
          );
        });
      },
      error: () => {
        // Mantener funcional la UI si el SSE de logs falla.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Sin logs históricos la vista sigue disponible.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshotView) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track Easy-rate progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getEasyRateJobStatus(jobId).subscribe({
      next: (jobResponse: EasyRateJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Easy-rate job failed with no details.');
          return;
        }

        const finalResult: EasyRateResultData | null = this.extractResultData(jobResponse);
        if (finalResult === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final payload is invalid for Easy-rate.');
          return;
        }

        this.resultData.set(finalResult);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get Easy-rate final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: EasyRateJobResponseView): EasyRateResultData | null {
    const results = jobResponse.results;
    if (results === null || results === undefined) {
      return this.buildSummaryData(jobResponse);
    }
    const fileDescriptors: EasyRateFileDescriptor[] = jobResponse.parameters.file_descriptors.map(
      (fd) => ({
        fieldName: fd.field_name,
        originalFilename: fd.original_filename,
        sizeBytes: fd.size_bytes,
      }),
    );
    return {
      title: results.title,
      rateConstant: results.rate_constant,
      rateConstantTst: results.rate_constant_tst,
      rateConstantDiffusionCorrected: results.rate_constant_diffusion_corrected,
      kDiff: results.k_diff,
      gibbsReactionKcalMol: results.gibbs_reaction_kcal_mol,
      gibbsActivationKcalMol: results.gibbs_activation_kcal_mol,
      enthalpyReactionKcalMol: results.enthalpy_reaction_kcal_mol,
      enthalpyActivationKcalMol: results.enthalpy_activation_kcal_mol,
      zpeReactionKcalMol: results.zpe_reaction_kcal_mol,
      zpeActivationKcalMol: results.zpe_activation_kcal_mol,
      tunnelU: results.tunnel_u,
      tunnelAlpha1: results.tunnel_alpha_1,
      tunnelAlpha2: results.tunnel_alpha_2,
      tunnelG: results.tunnel_g,
      kappaTst: results.kappa_tst,
      temperatureK: results.temperature_k,
      imaginaryFrequencyCm1: results.imaginary_frequency_cm1,
      reactionPathDegeneracy: results.reaction_path_degeneracy,
      warnNegativeActivation: results.warn_negative_activation,
      cageEffectsApplied: results.cage_effects_applied,
      diffusionApplied: results.diffusion_applied,
      solventUsed: results.solvent_used,
      viscosityPaS: results.viscosity_pa_s,
      fileDescriptors,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private buildSummaryData(jobResponse: EasyRateJobResponseView): EasyRateResultData | null {
    const params = jobResponse.parameters;
    const fileDescriptors: EasyRateFileDescriptor[] = params.file_descriptors.map((fd) => ({
      fieldName: fd.field_name,
      originalFilename: fd.original_filename,
      sizeBytes: fd.size_bytes,
    }));
    return {
      title: params.title,
      rateConstant: null,
      rateConstantTst: null,
      rateConstantDiffusionCorrected: null,
      kDiff: null,
      gibbsReactionKcalMol: 0,
      gibbsActivationKcalMol: 0,
      enthalpyReactionKcalMol: 0,
      enthalpyActivationKcalMol: 0,
      zpeReactionKcalMol: 0,
      zpeActivationKcalMol: 0,
      tunnelU: null,
      tunnelAlpha1: null,
      tunnelAlpha2: null,
      tunnelG: null,
      kappaTst: 0,
      temperatureK: 0,
      imaginaryFrequencyCm1: 0,
      reactionPathDegeneracy: params.reaction_path_degeneracy,
      warnNegativeActivation: false,
      cageEffectsApplied: params.cage_effects,
      diffusionApplied: params.diffusion,
      solventUsed: params.solvent,
      viscosityPaS: params.custom_viscosity,
      fileDescriptors,
      isHistoricalSummary: true,
      summaryMessage: this.buildHistoricalSummaryMessage(jobResponse.status),
    };
  }

  private buildHistoricalSummaryMessage(status: string): string {
    if (status === 'pending') return 'Historical summary: this job is still pending execution.';
    if (status === 'running') return 'Historical summary: this job is still running.';
    if (status === 'paused') return 'Historical summary: this job is paused.';
    return 'Historical summary: no final result payload was available.';
  }
}

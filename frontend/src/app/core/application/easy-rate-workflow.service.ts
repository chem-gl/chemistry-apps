// easy-rate-workflow.service.ts: Orquesta formulario multipart, progreso y resultados de la app Easy-rate.
// Gestiona señales de archivos Gaussian, parámetros cinéticos y el ciclo de vida del job asíncrono.

import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subscription, finalize } from 'rxjs';
import {
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateInspectionExecutionView,
  EasyRateJobResponseView,
  EasyRateParams,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';
import { buildEasyRateSummaryData, extractEasyRateResultData } from './easy-rate-result-mapper';
import {
  EASY_RATE_FIELD_LABELS,
  EasyRateExecutionSelectionMap,
  EasyRateInspectionErrorMap,
  EasyRateInspectionLoadingMap,
  EasyRateInspectionMap,
  EasyRateResultData,
  buildEasyRateFieldRecord,
} from './easy-rate-workflow.types';

@Injectable()
export class EasyRateWorkflowService extends BaseJobWorkflowService<EasyRateResultData> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing Easy-rate job...';
  }

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

  // ── Señales derivadas ─────────────────────────────────────────────
  readonly canDispatch = computed(
    () => this.validateBeforeDispatch() === null && !this.isProcessing(),
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
  override dispatch(): void {
    const validationError: string | null = this.validateBeforeDispatch();
    if (validationError !== null) {
      this.errorMessage.set(validationError);
      return;
    }

    const tsFile: File = this.transitionStateFile() as File;
    const reactant1File: File = this.reactant1File() as File;
    const reactant2File: File = this.reactant2File() as File;

    this.prepareForDispatch();

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
        this.handleDispatchJobResponse(
          jobResponse,
          (job) => extractEasyRateResultData(job),
          'Easy-rate',
        );
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
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getEasyRateJobStatus(jobId).subscribe({
      next: (jobResponse: EasyRateJobResponseView) => {
        this.handleJobOutcome(
          jobId,
          jobResponse,
          (job) =>
            extractEasyRateResultData(job) ??
            buildEasyRateSummaryData(job, this.buildHistoricalSummaryMessage(job.status)),
          { loadHistoryAfter: false },
        );
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('easy-rate');
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

  override ngOnDestroy(): void {
    super.ngOnDestroy();
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

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getEasyRateJobStatus(jobId).subscribe({
      next: (jobResponse: EasyRateJobResponseView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => extractEasyRateResultData(job));
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get Easy-rate final result: ${statusError.message}`);
      },
    });
  }
}

// marcus-workflow.service.ts: Orquesta formulario multipart, progreso y resultados de la app Marcus.
// Gestiona los 6 archivos Gaussian requeridos, parámetros de difusión y el ciclo de vida del job.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  MarcusJobResponseView,
  MarcusParams,
  ScientificJobView,
} from '../api/jobs-api.service';

/** Secciones de pantalla activas durante el ciclo de vida del job Marcus */
type MarcusSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

/** Descriptor compacto de archivo de entrada para presentación en UI */
export interface MarcusFileDescriptor {
  fieldName: string;
  originalFilename: string;
  sizeBytes: number;
}

/** Resultado mapeado de Marcus para consumo en la vista */
export interface MarcusResultData {
  title: string;
  // Energías (kcal/mol)
  adiabaticEnergyKcalMol: number;
  adiabaticEnergyCorrectedKcalMol: number;
  verticalEnergyKcalMol: number;
  reorganizationEnergyKcalMol: number;
  barrierKcalMol: number;
  // Constantes de velocidad
  rateConstantTst: number;
  rateConstant: number;
  kDiff: number | null;
  // Condiciones
  diffusionApplied: boolean;
  temperatureK: number;
  viscosityPaS: number | null;
  // Archivos de entrada persistidos
  fileDescriptors: MarcusFileDescriptor[];
  // Estado histórico
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class MarcusWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  // ── Señales de los 6 archivos Gaussian requeridos ─────────────────
  readonly reactant1File = signal<File | null>(null);
  readonly reactant2File = signal<File | null>(null);
  readonly product1AdiabaticFile = signal<File | null>(null);
  readonly product2AdiabaticFile = signal<File | null>(null);
  readonly product1VerticalFile = signal<File | null>(null);
  readonly product2VerticalFile = signal<File | null>(null);

  // ── Señales de parámetros opcionales ──────────────────────────────
  readonly title = signal<string>('');
  readonly diffusion = signal<boolean>(false);
  readonly radiusReactant1 = signal<number | null>(null);
  readonly radiusReactant2 = signal<number | null>(null);
  readonly reactionDistance = signal<number | null>(null);

  // ── Estado del flujo ──────────────────────────────────────────────
  readonly activeSection = signal<MarcusSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<MarcusResultData | null>(null);
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
    () =>
      this.reactant1File() !== null &&
      this.reactant2File() !== null &&
      this.product1AdiabaticFile() !== null &&
      this.product2AdiabaticFile() !== null &&
      this.product1VerticalFile() !== null &&
      this.product2VerticalFile() !== null &&
      !this.isProcessing(),
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing Marcus job...',
  );
  readonly showDiffusionFields = computed(() => this.diffusion());

  // ── Actualizadores de archivos ────────────────────────────────────
  updateReactant1File(file: File | null): void {
    this.reactant1File.set(file);
  }
  updateReactant2File(file: File | null): void {
    this.reactant2File.set(file);
  }
  updateProduct1AdiabaticFile(file: File | null): void {
    this.product1AdiabaticFile.set(file);
  }
  updateProduct2AdiabaticFile(file: File | null): void {
    this.product2AdiabaticFile.set(file);
  }
  updateProduct1VerticalFile(file: File | null): void {
    this.product1VerticalFile.set(file);
  }
  updateProduct2VerticalFile(file: File | null): void {
    this.product2VerticalFile.set(file);
  }

  // ── Actualizadores de parámetros ──────────────────────────────────
  updateTitle(value: string): void {
    this.title.set(value);
  }
  updateDiffusion(value: boolean): void {
    this.diffusion.set(value);
    if (!value) {
      this.radiusReactant1.set(null);
      this.radiusReactant2.set(null);
      this.reactionDistance.set(null);
    }
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

  /** Despacha el job Marcus al backend usando los 6 archivos y parámetros actuales */
  dispatch(): void {
    const r1 = this.reactant1File();
    const r2 = this.reactant2File();
    const p1a = this.product1AdiabaticFile();
    const p2a = this.product2AdiabaticFile();
    const p1v = this.product1VerticalFile();
    const p2v = this.product2VerticalFile();

    if (
      r1 === null ||
      r2 === null ||
      p1a === null ||
      p2a === null ||
      p1v === null ||
      p2v === null
    ) {
      this.errorMessage.set('All six Gaussian files are required for Marcus calculation.');
      return;
    }

    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const params: MarcusParams = {
      reactant1File: r1,
      reactant2File: r2,
      product1AdiabaticFile: p1a,
      product2AdiabaticFile: p2a,
      product1VerticalFile: p1v,
      product2VerticalFile: p2v,
      title: this.title() || undefined,
      diffusion: this.diffusion(),
      radiusReactant1: this.radiusReactant1() ?? undefined,
      radiusReactant2: this.radiusReactant2() ?? undefined,
      reactionDistance: this.reactionDistance() ?? undefined,
    };

    this.jobsApiService.dispatchMarcusJob(params).subscribe({
      next: (jobResponse: MarcusJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResult: MarcusResultData | null = this.extractResultData(jobResponse);
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
        this.errorMessage.set(`Unable to create Marcus job: ${dispatchError.message}`);
      },
    });
  }

  /** Resetea el flujo de ejecución sin borrar archivos cargados */
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

  /** Limpia todos los archivos seleccionados */
  clearFiles(): void {
    this.reactant1File.set(null);
    this.reactant2File.set(null);
    this.product1AdiabaticFile.set(null);
    this.product2AdiabaticFile.set(null);
    this.product1VerticalFile.set(null);
    this.product2VerticalFile.set(null);
  }

  /** Abre y reconstruye la vista de un job Marcus histórico por UUID */
  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getMarcusJobStatus(jobId).subscribe({
      next: (jobResponse: MarcusJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(
            jobResponse.error_trace ?? 'Historical Marcus job ended with error.',
          );
          return;
        }

        const historicalData: MarcusResultData | null =
          this.extractResultData(jobResponse) ?? this.buildSummaryData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical Marcus job output.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical Marcus job: ${statusError.message}`);
      },
    });
  }

  /** Recarga el historial de jobs Marcus del servidor */
  loadHistory(): void {
    this.isHistoryLoading.set(true);
    this.jobsApiService.listJobs({ pluginName: 'marcus' }).subscribe({
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
      this.jobsApiService.downloadMarcusCsvReport(this.currentJobId()!),
      'CSV',
    );
  }

  /** Descarga el reporte LOG del job activo */
  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadMarcusLogReport(this.currentJobId()!),
      'LOG',
    );
  }

  /** Descarga el reporte de error del job activo */
  downloadErrorReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadMarcusErrorReport(this.currentJobId()!),
      'error report',
    );
  }

  /** Descarga el ZIP de archivos de entrada del job activo */
  downloadInputsZip(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadMarcusInputsZip(this.currentJobId()!),
      'inputs ZIP',
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
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
        // Mantener UI funcional si el SSE de logs falla.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Vista histórica disponible sin logs si falla la consulta.
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
        this.errorMessage.set(`Unable to track Marcus job progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getMarcusJobStatus(jobId).subscribe({
      next: (jobResponse: MarcusJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Marcus job failed with no details.');
          return;
        }

        const finalResult: MarcusResultData | null = this.extractResultData(jobResponse);
        if (finalResult === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final payload is invalid for Marcus.');
          return;
        }

        this.resultData.set(finalResult);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get Marcus final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: MarcusJobResponseView): MarcusResultData | null {
    const results = jobResponse.results;
    if (results === null || results === undefined) {
      return this.buildSummaryData(jobResponse);
    }
    const fileDescriptors: MarcusFileDescriptor[] = jobResponse.parameters.file_descriptors.map(
      (fd) => ({
        fieldName: fd.field_name,
        originalFilename: fd.original_filename,
        sizeBytes: fd.size_bytes,
      }),
    );
    return {
      title: results.title,
      adiabaticEnergyKcalMol: results.adiabatic_energy_kcal_mol,
      adiabaticEnergyCorrectedKcalMol: results.adiabatic_energy_corrected_kcal_mol,
      verticalEnergyKcalMol: results.vertical_energy_kcal_mol,
      reorganizationEnergyKcalMol: results.reorganization_energy_kcal_mol,
      barrierKcalMol: results.barrier_kcal_mol,
      rateConstantTst: results.rate_constant_tst,
      rateConstant: results.rate_constant,
      kDiff: results.k_diff,
      diffusionApplied: results.diffusion_applied,
      temperatureK: results.temperature_k,
      viscosityPaS: results.viscosity_pa_s,
      fileDescriptors,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private buildSummaryData(jobResponse: MarcusJobResponseView): MarcusResultData | null {
    const params = jobResponse.parameters;
    const fileDescriptors: MarcusFileDescriptor[] = params.file_descriptors.map((fd) => ({
      fieldName: fd.field_name,
      originalFilename: fd.original_filename,
      sizeBytes: fd.size_bytes,
    }));
    return {
      title: params.title,
      adiabaticEnergyKcalMol: 0,
      adiabaticEnergyCorrectedKcalMol: 0,
      verticalEnergyKcalMol: 0,
      reorganizationEnergyKcalMol: 0,
      barrierKcalMol: 0,
      rateConstantTst: 0,
      rateConstant: 0,
      kDiff: null,
      diffusionApplied: params.diffusion,
      temperatureK: 0,
      viscosityPaS: null,
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

// marcus-workflow.service.ts: Orquesta formulario multipart, progreso y resultados de la app Marcus.
// Gestiona los 6 archivos Gaussian requeridos, parámetros de difusión y el ciclo de vida del job.

import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { DownloadedReportFile, MarcusJobResponseView, MarcusParams } from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

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
export class MarcusWorkflowService extends BaseJobWorkflowService<MarcusResultData> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing Marcus job...';
  }

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

  // ── Señales derivadas ─────────────────────────────────────────────
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
  override dispatch(): void {
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

    this.prepareForDispatch();

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
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getMarcusJobStatus(jobId).subscribe({
      next: (jobResponse: MarcusJobResponseView) => {
        this.handleJobOutcome(
          jobId,
          jobResponse,
          (job) => this.extractResultData(job) ?? this.buildSummaryData(job),
          { loadHistoryAfter: false },
        );
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical Marcus job: ${statusError.message}`);
      },
    });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('marcus');
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

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getMarcusJobStatus(jobId).subscribe({
      next: (jobResponse: MarcusJobResponseView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job));
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
}

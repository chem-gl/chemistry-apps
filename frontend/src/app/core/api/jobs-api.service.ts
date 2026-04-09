// jobs-api.service.ts: Fachada API que envuelve los clientes generados de OpenAPI.
// Centraliza despacho, polling y reportes; delega streaming a JobsStreamingApiService
// y operaciones Smileit a SmileitApiService.

import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { createReportDownload$ } from './api-download.utils';
import {
  CalculatorJobCreateRequest,
  CalculatorJobResponse,
  CalculatorService,
  EasyRateJobResponse,
  EasyRateService,
  JobControlActionResponse,
  JobCreateRequest,
  JobProgressSnapshot,
  JobsService,
  MarcusJobResponse,
  MarcusService,
  MolarFractionsService,
  SAScoreService,
  SaScoreJobCreateRequest,
  ScientificJob,
  SourceFieldEnum,
  ToxicityJobCreateRequest,
  ToxicityPropertiesService,
  TunnelService,
} from './generated';
import { JobsStreamingApiService } from './jobs-streaming-api.service';
import { SmileitApiService } from './smileit-api.service';

// Re-exportación de todos los tipos para compatibilidad con imports existentes.
// Los consumidores pueden importar tipos directamente desde 'core/api/types' o desde aquí.
export type * from './types';

import type {
  CalculatorParams,
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateInspectionExecutionView,
  EasyRateParams,
  JobControlActionResult,
  JobListFilters,
  JobLogEntryView,
  JobLogsPageView,
  JobLogsQuery,
  JobsRealtimeEvent,
  JobsRealtimeQuery,
  MarcusParams,
  MolarFractionsParams,
  SaScoreJobResponseView,
  SaScoreMethod,
  SaScoreParams,
  ScientificJobDispatchParams,
  SmileitDerivationPageView,
  SmileitStructureInspectionView,
  SmilesCompatibilityResultView,
  ToxicityJobResponseView,
  ToxicityPropertiesParams,
  TunnelInputChangeEvent,
  TunnelParams,
} from './types';

interface EasyRateInspectionExecutionApiResponse {
  source_field: string;
  original_filename: string | null;
  execution_index: number;
  job_title: string | null;
  checkpoint_file: string | null;
  charge: number;
  multiplicity: number;
  free_energy: number | null;
  thermal_enthalpy: number | null;
  zero_point_energy: number | null;
  scf_energy: number | null;
  temperature: number | null;
  negative_frequencies: number;
  imaginary_frequency: number | null;
  normal_termination: boolean;
  is_opt_freq: boolean;
  is_valid_for_role: boolean;
  validation_errors: string[];
}

interface EasyRateInspectionApiResponse {
  source_field: string;
  original_filename: string | null;
  parse_errors: string[];
  execution_count: number;
  default_execution_index: number | null;
  executions: EasyRateInspectionExecutionApiResponse[];
}

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly calculatorClient = inject(CalculatorService);
  private readonly easyRateClient = inject(EasyRateService);
  private readonly marcusClient = inject(MarcusService);
  private readonly saScoreClient = inject(SAScoreService);
  private readonly molarFractionsClient = inject(MolarFractionsService);
  private readonly tunnelClient = inject(TunnelService);
  private readonly jobsClient = inject(JobsService);
  private readonly toxicityPropertiesClient = inject(ToxicityPropertiesService);
  private readonly streamingApi = inject(JobsStreamingApiService);
  private readonly smileitApi = inject(SmileitApiService);

  // --- Delegación a JobsStreamingApiService (compatibilidad con consumidores) ---

  /** Snapshot puntual de progreso para polling manual o reconexión SSE */
  getJobProgress(jobId: string): Observable<JobProgressSnapshot> {
    return this.streamingApi.getJobProgress(jobId);
  }

  /** Historial paginado de logs por job con cursor incremental */
  getJobLogs(jobId: string, query: JobLogsQuery = {}): Observable<JobLogsPageView> {
    return this.streamingApi.getJobLogs(jobId, query);
  }

  /** Stream SSE de progreso en tiempo real: completa al llegar a estado terminal */
  streamJobEvents(jobId: string): Observable<JobProgressSnapshot> {
    return this.streamingApi.streamJobEvents(jobId);
  }

  /** Stream SSE de logs en tiempo real para un job específico */
  streamJobLogEvents(jobId: string): Observable<JobLogEntryView> {
    return this.streamingApi.streamJobLogEvents(jobId);
  }

  /** Stream WebSocket global o filtrado para jobs, progreso y logs */
  streamJobsRealtime(query: JobsRealtimeQuery = {}): Observable<JobsRealtimeEvent> {
    return this.streamingApi.streamJobsRealtime(query);
  }

  /** Polling de progreso periódico hasta estado terminal (fallback robusto sin SSE) */
  pollJobUntilCompleted(jobId: string, intervalMs: number = 1000): Observable<JobProgressSnapshot> {
    return this.streamingApi.pollJobUntilCompleted(jobId, intervalMs);
  }

  // --- Delegación temporal a SmileitApiService (consumidores heredados) ---

  /** Valida compatibilidad SMILES usando inspección Smileit (usado por SA Score y Toxicity) */
  validateSmilesCompatibility(smilesList: string[]): Observable<SmilesCompatibilityResultView> {
    return this.smileitApi.validateSmilesCompatibility(smilesList);
  }

  /** Inspecciona estructura SMILES (usado por componentes heredados) */
  inspectSmileitStructure(smiles: string): Observable<SmileitStructureInspectionView> {
    return this.smileitApi.inspectSmileitStructure(smiles);
  }

  /** Descarga ZIP server-side con imágenes SVG de Smileit */
  downloadSmileitImagesZipServer(jobId: string): Observable<DownloadedReportFile> {
    return this.smileitApi.downloadSmileitImagesZipServer(jobId);
  }

  /** Lista derivados Smile-it paginados */
  listSmileitDerivations(
    jobId: string,
    offset: number,
    limit: number,
  ): Observable<SmileitDerivationPageView> {
    return this.smileitApi.listSmileitDerivations(jobId, offset, limit);
  }

  /** Obtiene SVG on-demand de un derivado específico */
  getSmileitDerivationSvg(
    jobId: string,
    structureIndex: number,
    variant: 'thumb' | 'detail' = 'detail',
  ): Observable<string> {
    return this.smileitApi.getSmileitDerivationSvg(jobId, structureIndex, variant);
  }

  // --- Helpers privados ---

  private normalizeControlActionResult(
    rawResponse: JobControlActionResponse,
  ): JobControlActionResult {
    return {
      detail: rawResponse.detail,
      job: rawResponse.job,
    };
  }

  private normalizeEasyRateInspectionExecution(
    rawExecution: EasyRateInspectionExecutionApiResponse,
  ): EasyRateInspectionExecutionView {
    return {
      sourceField: rawExecution.source_field as EasyRateInputFieldName,
      originalFilename: rawExecution.original_filename,
      executionIndex: rawExecution.execution_index,
      jobTitle: rawExecution.job_title,
      checkpointFile: rawExecution.checkpoint_file,
      charge: rawExecution.charge,
      multiplicity: rawExecution.multiplicity,
      freeEnergy: rawExecution.free_energy,
      thermalEnthalpy: rawExecution.thermal_enthalpy,
      zeroPointEnergy: rawExecution.zero_point_energy,
      scfEnergy: rawExecution.scf_energy,
      temperature: rawExecution.temperature,
      negativeFrequencies: rawExecution.negative_frequencies,
      imaginaryFrequency: rawExecution.imaginary_frequency,
      normalTermination: rawExecution.normal_termination,
      isOptFreq: rawExecution.is_opt_freq,
      isValidForRole: rawExecution.is_valid_for_role,
      validationErrors: rawExecution.validation_errors,
    };
  }

  private normalizeEasyRateInspection(
    rawInspection: EasyRateInspectionApiResponse,
  ): EasyRateFileInspectionView {
    return {
      sourceField: rawInspection.source_field as EasyRateInputFieldName,
      originalFilename: rawInspection.original_filename,
      parseErrors: rawInspection.parse_errors,
      executionCount: rawInspection.execution_count,
      defaultExecutionIndex: rawInspection.default_execution_index,
      executions: rawInspection.executions.map((execution) =>
        this.normalizeEasyRateInspectionExecution(execution),
      ),
    };
  }

  // --- Jobs genéricos y despacho ---

  /**
   * Lista jobs globales del sistema con filtros opcionales por plugin y estado.
   * Se usa en el monitor para visualizar activos, completados y fallidos.
   */
  listJobs(filters: JobListFilters = {}): Observable<ScientificJob[]> {
    return this.jobsClient.jobsList(filters.pluginName, filters.status).pipe(shareReplay(1));
  }

  /**
   * Despacha un job científico genérico vía el endpoint core /api/jobs/.
   * Se usa para nuevas apps sin acoplar componentes al código generado.
   */
  dispatchScientificJob(params: ScientificJobDispatchParams): Observable<ScientificJob> {
    const payload: JobCreateRequest = {
      plugin_name: params.pluginName,
      version: params.version ?? '1.0.0',
      parameters: params.parameters,
    };
    return this.jobsClient.jobsCreate(payload).pipe(shareReplay(1));
  }

  /** Despacha un job de molar fractions vía API core desacoplada */
  dispatchMolarFractionsJob(params: MolarFractionsParams): Observable<ScientificJob> {
    const normalizedPkaValues: number[] = params.pkaValues.map(Number);
    if (normalizedPkaValues.length < 1 || normalizedPkaValues.length > 6) {
      throw new Error('molar-fractions requiere entre 1 y 6 valores pKa.');
    }

    const payloadParameters: Record<string, unknown> = {
      pka_values: normalizedPkaValues,
      ph_mode: params.phMode,
    };

    if (params.phMode === 'single') {
      if (params.phValue === undefined) {
        throw new Error('phValue es obligatorio cuando phMode=single.');
      }
      payloadParameters['ph_value'] = Number(params.phValue);
    } else {
      if (params.phMin === undefined || params.phMax === undefined || params.phStep === undefined) {
        throw new Error('phMin, phMax y phStep son obligatorios cuando phMode=range.');
      }
      payloadParameters['ph_min'] = Number(params.phMin);
      payloadParameters['ph_max'] = Number(params.phMax);
      payloadParameters['ph_step'] = Number(params.phStep);
    }

    return this.dispatchScientificJob({
      pluginName: 'molar-fractions',
      version: params.version ?? '1.0.0',
      parameters: payloadParameters,
    });
  }

  /** Despacha un job de efecto túnel vía API core desacoplada */
  dispatchTunnelJob(params: TunnelParams): Observable<ScientificJob> {
    if (params.reactionBarrierZpe <= 0) {
      throw new Error('reactionBarrierZpe must be greater than zero.');
    }

    if (params.imaginaryFrequency <= 0) {
      throw new Error('imaginaryFrequency must be greater than zero.');
    }

    if (params.temperature <= 0) {
      throw new Error('temperature must be greater than zero.');
    }

    const payloadParameters: Record<string, unknown> = {
      reaction_barrier_zpe: Number(params.reactionBarrierZpe),
      imaginary_frequency: Number(params.imaginaryFrequency),
      reaction_energy_zpe: Number(params.reactionEnergyZpe),
      temperature: Number(params.temperature),
      input_change_events: params.inputChangeEvents.map((eventItem: TunnelInputChangeEvent) => ({
        field_name: eventItem.fieldName,
        previous_value: Number(eventItem.previousValue),
        new_value: Number(eventItem.newValue),
        changed_at: eventItem.changedAt,
      })),
    };

    return this.dispatchScientificJob({
      pluginName: 'tunnel-effect',
      version: params.version ?? '2.0.0',
      parameters: payloadParameters,
    });
  }

  /** Consulta un job científico genérico por id mediante /api/jobs/{id}/ */
  getScientificJobStatus(jobId: string): Observable<ScientificJob> {
    return this.jobsClient.jobsRetrieve(jobId);
  }

  /** Descarga el reporte CSV de molar fractions directamente desde backend */
  downloadMolarFractionsCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.molarFractionsClient.molarFractionsJobsReportCsvRetrieve(jobId, 'response'),
      `molar_fractions_${jobId}_report.csv`,
    );
  }

  /** Descarga el reporte LOG de molar fractions directamente desde backend */
  downloadMolarFractionsLogReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.molarFractionsClient.molarFractionsJobsReportLogRetrieve(jobId, 'response'),
      `molar_fractions_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte CSV de Tunnel directamente desde backend */
  downloadTunnelCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.tunnelClient.tunnelJobsReportCsvRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_report.csv`,
    );
  }

  /** Descarga el reporte LOG de Tunnel directamente desde backend */
  downloadTunnelLogReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.tunnelClient.tunnelJobsReportLogRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte de error de Tunnel cuando el job falla */
  downloadTunnelErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.tunnelClient.tunnelJobsReportErrorRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_error.txt`,
    );
  }

  // --- Control de jobs ---

  /** Solicita pausa cooperativa de un job cuando su plugin lo permite */
  pauseJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsPauseCreate(jobId).pipe(
      map((rawResponse) => this.normalizeControlActionResult(rawResponse)),
      shareReplay(1),
    );
  }

  /** Reanuda un job pausado y dispara su reencolado */
  resumeJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsResumeCreate(jobId).pipe(
      map((rawResponse) => this.normalizeControlActionResult(rawResponse)),
      shareReplay(1),
    );
  }

  /** Cancela un job de forma irreversible (pending/running/paused -> cancelled) */
  cancelJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsCancelCreate(jobId).pipe(
      map((rawResponse) => this.normalizeControlActionResult(rawResponse)),
      shareReplay(1),
    );
  }

  // --- Calculator ---

  /**
   * Despacha un job de calculadora al backend.
   * Si existe caché (job_hash conocido), el backend retorna resultado inmediato con status 'completed'.
   * En caso contrario el job queda 'pending' hasta que el worker Celery lo procese.
   *
   * Para monitorear el progreso usar `streamJobEvents()` o `pollJobUntilCompleted()`.
   */
  dispatchCalculatorJob(
    params: CalculatorParams,
    version: string = '1.0.0',
  ): Observable<CalculatorJobResponse> {
    const payload: CalculatorJobCreateRequest = {
      version,
      op: params.op,
      a: params.a,
      // Omitir b completamente cuando no aplica (factorial)
      ...(params.b === undefined ? {} : { b: params.b }),
    };
    return this.calculatorClient.calculatorJobsCreate(payload).pipe(shareReplay(1));
  }

  /**
   * Consulta el estado completo y resultados de un job de calculadora.
   * Usar tras confirmar status 'completed' para obtener el CalculatorResult con tipos estrictos.
   */
  getJobStatus(jobId: string): Observable<CalculatorJobResponse> {
    return this.calculatorClient.calculatorJobsRetrieve(jobId);
  }

  // --- Easy-rate ---

  /** Inspecciona un archivo Gaussian y devuelve ejecuciones candidatas para Easy-rate. */
  inspectEasyRateInput(
    sourceField: EasyRateInputFieldName,
    gaussianFile: File,
  ): Observable<EasyRateFileInspectionView> {
    return this.easyRateClient
      .easyRateJobsInspectInputCreate(sourceField as SourceFieldEnum, gaussianFile)
      .pipe(
        map((rawInspection) => this.normalizeEasyRateInspection(rawInspection)),
        shareReplay(1),
      );
  }

  /** Despacha un job Easy-rate con archivos Gaussian en multipart */
  dispatchEasyRateJob(params: EasyRateParams): Observable<EasyRateJobResponse> {
    return this.easyRateClient
      .easyRateJobsCreate(
        params.reactant1File,
        params.reactant2File,
        params.transitionStateFile,
        params.version ?? '2.0.0',
        params.title,
        params.reactionPathDegeneracy,
        params.cageEffects,
        params.diffusion,
        params.solvent,
        params.customViscosity,
        params.radiusReactant1,
        params.radiusReactant2,
        params.reactionDistance,
        params.printDataInput,
        params.reactant1ExecutionIndex,
        params.reactant2ExecutionIndex,
        params.transitionStateExecutionIndex,
        params.product1ExecutionIndex,
        params.product2ExecutionIndex,
        params.product1File,
        params.product2File,
      )
      .pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job Easy-rate por UUID */
  getEasyRateJobStatus(jobId: string): Observable<EasyRateJobResponse> {
    return this.easyRateClient.easyRateJobsRetrieve(jobId);
  }

  /** Descarga reporte CSV de Easy-rate */
  downloadEasyRateCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.easyRateClient.easyRateJobsReportCsvRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_report.csv`,
    );
  }

  /** Descarga reporte LOG de Easy-rate */
  downloadEasyRateLogReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.easyRateClient.easyRateJobsReportLogRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_report.log`,
    );
  }

  /** Descarga reporte de error de Easy-rate */
  downloadEasyRateErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.easyRateClient.easyRateJobsReportErrorRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP de archivos de entrada originales de Easy-rate */
  downloadEasyRateInputsZip(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.easyRateClient.easyRateJobsReportInputsRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_inputs.zip`,
    );
  }

  // --- Marcus ---

  /** Despacha un job Marcus con 6 archivos Gaussian en multipart */
  dispatchMarcusJob(params: MarcusParams): Observable<MarcusJobResponse> {
    return this.marcusClient
      .marcusJobsCreate(
        params.reactant1File,
        params.reactant2File,
        params.product1AdiabaticFile,
        params.product2AdiabaticFile,
        params.product1VerticalFile,
        params.product2VerticalFile,
        params.version ?? '1.0.0',
        params.title,
        params.diffusion,
        params.radiusReactant1,
        params.radiusReactant2,
        params.reactionDistance,
      )
      .pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job Marcus por UUID */
  getMarcusJobStatus(jobId: string): Observable<MarcusJobResponse> {
    return this.marcusClient.marcusJobsRetrieve(jobId);
  }

  /** Descarga reporte CSV de Marcus */
  downloadMarcusCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.marcusClient.marcusJobsReportCsvRetrieve(jobId, 'response'),
      `marcus_${jobId}_report.csv`,
    );
  }

  /** Descarga reporte LOG de Marcus */
  downloadMarcusLogReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.marcusClient.marcusJobsReportLogRetrieve(jobId, 'response'),
      `marcus_${jobId}_report.log`,
    );
  }

  /** Descarga reporte de error de Marcus */
  downloadMarcusErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.marcusClient.marcusJobsReportErrorRetrieve(jobId, 'response'),
      `marcus_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP de archivos de entrada originales de Marcus */
  downloadMarcusInputsZip(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.marcusClient.marcusJobsReportInputsRetrieve(jobId, 'response'),
      `marcus_${jobId}_inputs.zip`,
    );
  }

  // --- SA Score ---

  /** Despacha un job SA score para una lista de SMILES y métodos seleccionados. */
  dispatchSaScoreJob(params: SaScoreParams): Observable<SaScoreJobResponseView> {
    const payload: SaScoreJobCreateRequest = {
      molecules: params.molecules,
      methods: params.methods,
      version: params.version ?? '1.0.0',
    };

    return this.saScoreClient.saScoreJobsCreate(payload).pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job SA score por UUID. */
  getSaScoreJobStatus(jobId: string): Observable<SaScoreJobResponseView> {
    return this.saScoreClient.saScoreJobsRetrieve(jobId).pipe(shareReplay(1));
  }

  /** Descarga CSV completo (todas las columnas de métodos solicitados) para SA score. */
  downloadSaScoreCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.saScoreClient.saScoreJobsReportCsvRetrieve(jobId, 'response'),
      `sa_score_${jobId}_report.csv`,
    );
  }

  /** Descarga CSV de un método específico con formato smiles,sa para SA score. */
  downloadSaScoreCsvMethodReport(
    jobId: string,
    method: SaScoreMethod,
  ): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.saScoreClient.saScoreJobsReportCsvMethodRetrieve(jobId, method, 'response'),
      `sa_score_${jobId}_${method}.csv`,
    );
  }

  // --- Toxicity Properties ---

  /** Despacha un job de Toxicity Properties para una lista de SMILES. */
  dispatchToxicityPropertiesJob(
    params: ToxicityPropertiesParams,
  ): Observable<ToxicityJobResponseView> {
    const payload: ToxicityJobCreateRequest = {
      molecules: params.molecules,
      version: params.version ?? '1.0.0',
    };
    return this.toxicityPropertiesClient.toxicityPropertiesJobsCreate(payload).pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job de Toxicity Properties por UUID. */
  getToxicityPropertiesJobStatus(jobId: string): Observable<ToxicityJobResponseView> {
    return this.toxicityPropertiesClient.toxicityPropertiesJobsRetrieve(jobId).pipe(shareReplay(1));
  }

  /** Descarga CSV toxicológico (columnas fijas) para un job completado. */
  downloadToxicityPropertiesCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return createReportDownload$(
      this.toxicityPropertiesClient.toxicityPropertiesJobsReportCsvRetrieve(jobId, 'response'),
      `toxicity_properties_${jobId}_report.csv`,
    );
  }
}

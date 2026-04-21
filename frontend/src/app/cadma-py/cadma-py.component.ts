// cadma-py.component.ts: Interfaz principal de CADMA Py para familias de referencia, scoring y gráficas.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { EChartsCoreOption } from 'echarts/core';
import { Subscription } from 'rxjs';
import {
  CadmaMetricChartView,
  CadmaPyApiService,
  CadmaReferenceLibraryView,
  CadmaReferenceRowView,
  CadmaReferenceSampleView,
  CadmaSamplePreviewRowView,
  CadmaScoreConfigView,
  type CadmaLinkedJobView,
} from '../core/api/cadma-py-api.service';
import { SaScoreMethod, ScientificJobView } from '../core/api/jobs-api.service';
import {
  CadmaPyQuickFillService,
  extractRequestedSaMethods,
  inspectCadmaSourceConfigs,
  pickPreferredHistoricalJobId,
  previewCadmaSourceConfigs,
  resolveScientificJobLabel,
} from '../core/application/cadma-py-quick-fill.service';
import { CadmaPyWorkflowService } from '../core/application/cadma-py-workflow.service';
import { JobHistoryTableComponent } from '../core/shared/components/job-history-table/job-history-table.component';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { ScientificChartComponent } from '../core/shared/components/scientific-chart/scientific-chart.component';
import {
  downloadBlobFile,
  subscribeToRouteHistoricalJob,
} from '../core/shared/scientific-app-ui.utils';
import {
  buildCadmaMetricChartOptions,
  buildCadmaScoreChartOptions,
} from './cadma-py-chart.options';
import {
  CadmaPyDeleteModalComponent,
  type DeleteConfirmationResult,
} from './cadma-py-delete-modal.component';
import { CadmaPyFamilyDetailComponent } from './cadma-py-family-detail.component';
import {
  CadmaPyImporterComponent,
  type CadmaImportStateChange,
} from './cadma-py-importer.component';

interface CsvBundle {
  combined: string;
  smiles: string;
  toxicity: string;
  sa: string;
  combinedFile: File | null;
  smilesFile: File | null;
  toxicityFile: File | null;
  saFile: File | null;
  combinedName: string;
  smilesName: string;
  toxicityName: string;
  saName: string;
}

type CsvKind = 'combined' | 'smiles' | 'toxicity' | 'sa';
type CadmaIntervalMetric = 'MW' | 'logP' | 'MR' | 'AtX' | 'HBLA' | 'HBLD' | 'RB' | 'PSA';
type CadmaFormulaMetric = 'LD50' | 'M' | 'DT' | 'SA';
type CadmaWeightMetric = 'adme' | 'toxicity' | 'sa';
type QuickFillSelectableSaMethod = SaScoreMethod | '';

interface CadmaIntervalEditorRow {
  metric: CadmaIntervalMetric;
  min: number;
  max: number;
}

const LEGACY_INTERVAL_ORDER: readonly CadmaIntervalMetric[] = [
  'MW',
  'logP',
  'MR',
  'AtX',
  'HBLA',
  'HBLD',
  'RB',
  'PSA',
];

const LEGACY_DEFAULT_INTERVALS: Record<CadmaIntervalMetric, { min: number; max: number }> = {
  MW: { min: 200, max: 480 },
  logP: { min: -0.4, max: 5 },
  MR: { min: 40, max: 130 },
  AtX: { min: 20, max: 70 },
  HBLA: { min: 0, max: 10 },
  HBLD: { min: 0, max: 5 },
  RB: { min: 0, max: 10 },
  PSA: { min: 0, max: 130 },
};

const LEGACY_DEFAULT_REFERENCES: Record<CadmaFormulaMetric, number> = {
  LD50: 450,
  M: 0.12,
  DT: 0.2,
  SA: 84,
};

const LEGACY_DEFAULT_WEIGHTS: Record<CadmaWeightMetric, number> = {
  adme: 0.4,
  toxicity: 0.4,
  sa: 0.2,
};

function cloneLegacyIntervals(): Record<CadmaIntervalMetric, { min: number; max: number }> {
  return Object.fromEntries(
    LEGACY_INTERVAL_ORDER.map((metric) => [metric, { ...LEGACY_DEFAULT_INTERVALS[metric] }]),
  ) as Record<CadmaIntervalMetric, { min: number; max: number }>;
}

function toFiniteNumber(rawValue: string | number, fallbackValue: number): number {
  const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function computeFormulaReferenceValues(
  rows: CadmaReferenceRowView[],
): Record<CadmaFormulaMetric, number> {
  if (rows.length === 0) {
    return { ...LEGACY_DEFAULT_REFERENCES };
  }

  const average = (metric: CadmaFormulaMetric): number =>
    rows.reduce((total, row) => total + row[metric], 0) / Math.max(rows.length, 1);

  return {
    LD50: Number(average('LD50').toFixed(4)),
    M: Number(average('M').toFixed(4)),
    DT: Number(average('DT').toFixed(4)),
    SA: Number(average('SA').toFixed(4)),
  };
}

function createEmptyCsvBundle(): CsvBundle {
  return {
    combined: '',
    smiles: '',
    toxicity: '',
    sa: '',
    combinedFile: null,
    smilesFile: null,
    toxicityFile: null,
    saFile: null,
    combinedName: '',
    smilesName: '',
    toxicityName: '',
    saName: '',
  };
}

@Component({
  selector: 'app-cadma-py',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    ScientificChartComponent,
    JobLogsPanelComponent,
    JobHistoryTableComponent,
    CadmaPyFamilyDetailComponent,
    CadmaPyImporterComponent,
    CadmaPyDeleteModalComponent,
  ],
  providers: [CadmaPyWorkflowService],
  templateUrl: './cadma-py.component.html',
  styleUrl: './cadma-py.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyComponent implements OnInit, OnDestroy {
  private readonly cadmaApi = inject(CadmaPyApiService);
  private readonly quickFillService = inject(CadmaPyQuickFillService);
  private readonly route = inject(ActivatedRoute);
  readonly workflow = inject(CadmaPyWorkflowService);
  private routeSubscription: Subscription | null = null;

  @ViewChild(CadmaPyDeleteModalComponent)
  private readonly deleteModal?: CadmaPyDeleteModalComponent;

  readonly libraries = signal<CadmaReferenceLibraryView[]>([]);
  readonly samples = signal<CadmaReferenceSampleView[]>([]);
  readonly isBusy = signal<boolean>(false);
  readonly selectedTransientLibrary = signal<CadmaReferenceLibraryView | null>(null);
  readonly libraryErrorMessage = signal<string | null>(null);

  /** Estado del modal de eliminación. */
  readonly deleteModalLibraryId = signal<string>('');
  readonly deleteModalLibraryName = signal<string>('');
  readonly deleteModalLinkedJobs = signal<CadmaLinkedJobView[]>([]);
  readonly deleteModalLoading = signal<boolean>(false);

  readonly libraryName = signal<string>('');
  readonly diseaseName = signal<string>('');
  readonly description = signal<string>('');
  readonly paperReference = signal<string>('');
  readonly paperUrl = signal<string>('');
  readonly selectedMetric = signal<string>('MW');
  readonly scoreChartType = signal<'bar' | 'line' | 'scatter'>('bar');
  readonly metricChartType = signal<'bar' | 'line' | 'scatter'>('bar');
  readonly quickFillSmileitJobs = signal<ScientificJobView[]>([]);
  readonly quickFillToxicityJobs = signal<ScientificJobView[]>([]);
  readonly quickFillSaScoreJobs = signal<ScientificJobView[]>([]);
  readonly quickFillLoading = signal<boolean>(false);
  readonly quickFillApplying = signal<boolean>(false);
  readonly quickFillErrorMessage = signal<string | null>(null);
  readonly quickFillSmileitJobId = signal<string>('');
  readonly quickFillToxicityJobId = signal<string>('');
  readonly quickFillSaScoreJobId = signal<string>('');
  readonly quickFillSaMethod = signal<QuickFillSelectableSaMethod>('');
  /** Vía activa en paso 2: generar desde Smile-it, reusar jobs previos, o importar CSV manual. */
  readonly candidatePathway = signal<'generate' | 'reuse' | 'manual' | ''>('');
  readonly legacyIntervals =
    signal<Record<CadmaIntervalMetric, { min: number; max: number }>>(cloneLegacyIntervals());
  readonly formulaReferences = signal<Record<CadmaFormulaMetric, number>>({
    ...LEGACY_DEFAULT_REFERENCES,
  });
  readonly formulaWeights = signal<Record<CadmaWeightMetric, number>>({
    ...LEGACY_DEFAULT_WEIGHTS,
  });

  readonly referenceBundle = signal<CsvBundle>(createEmptyCsvBundle());
  readonly candidateBundle = signal<CsvBundle>(createEmptyCsvBundle());
  readonly referenceSourceConfigsJson = signal<string>('');
  readonly candidateSourceConfigsJson = signal<string>('');
  readonly candidateDraftMessage = signal<string>('');
  readonly candidateImportedFilenames = signal<string[]>([]);
  readonly candidateImportedTotalFiles = signal<number>(0);
  readonly candidateImportedTotalUsableRows = signal<number>(0);
  readonly showCreateForm = signal<boolean>(false);
  readonly previewLibraryId = signal<string>('');
  readonly previewSampleKey = signal<string>('');
  readonly copiedLibraryId = signal<string>('');
  readonly samplePreviewRows = signal<CadmaSamplePreviewRowView[]>([]);
  readonly browsingSampleKey = signal<string>('');
  readonly browsingSampleLibrary = signal<CadmaReferenceLibraryView | null>(null);

  /** Familia que se está explorando (detalle completo) antes de seleccionar. */
  readonly browsingLibraryId = signal<string>('');
  readonly browsingLibrary = computed<CadmaReferenceLibraryView | null>(() => {
    const browsing = this.browsingLibraryId();
    return browsing ? (this.libraries().find((lib) => lib.id === browsing) ?? null) : null;
  });

  /** Cuenta cuántas familias guardadas fueron importadas desde muestras legacy. */
  readonly sampleImportCounts = computed<Record<string, number>>(() => {
    const libs = this.libraries();
    const counts: Record<string, number> = {};
    for (const sample of this.samples()) {
      counts[sample.key] = libs.filter(
        (lib) => lib.source_reference === 'root' && lib.name === sample.name,
      ).length;
    }
    return counts;
  });

  readonly selectedLibrary = computed<CadmaReferenceLibraryView | null>(() => {
    const selectedId = this.workflow.selectedReferenceLibraryId();
    const persistedLibrary = this.libraries().find((library) => library.id === selectedId) ?? null;
    if (persistedLibrary !== null) {
      return persistedLibrary;
    }

    const transientLibrary = this.selectedTransientLibrary();
    return transientLibrary?.id === selectedId ? transientLibrary : null;
  });
  readonly canEditSelected = computed<boolean>(() => this.selectedLibrary()?.editable ?? false);
  readonly canDeleteSelected = computed<boolean>(() => this.selectedLibrary()?.deletable ?? false);
  readonly topCandidate = computed(() => this.workflow.resultData()?.ranking[0] ?? null);
  readonly metricOptions = computed<string[]>(() => {
    const metricCharts = this.workflow.resultData()?.metric_charts ?? [];
    return metricCharts.map((chart) => chart.metric);
  });
  readonly activeMetricChart = computed<CadmaMetricChartView | null>(() => {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return null;
    }
    return resultData.metric_charts.find((chart) => chart.metric === this.selectedMetric()) ?? null;
  });
  readonly scoreChartOptions = computed<EChartsCoreOption | null>(() => {
    const resultData = this.workflow.resultData();
    return resultData === null
      ? null
      : buildCadmaScoreChartOptions(resultData.score_chart, this.scoreChartType());
  });
  readonly metricChartOptions = computed<EChartsCoreOption | null>(() => {
    const metricChart = this.activeMetricChart();
    return metricChart === null
      ? null
      : buildCadmaMetricChartOptions(metricChart, this.metricChartType());
  });
  readonly formulaIntervalRows = computed<CadmaIntervalEditorRow[]>(() => {
    const intervals = this.legacyIntervals();
    return LEGACY_INTERVAL_ORDER.map((metric) => ({
      metric,
      min: intervals[metric].min,
      max: intervals[metric].max,
    }));
  });
  readonly scoreWeightTotal = computed<number>(
    () => this.formulaWeights().adme + this.formulaWeights().toxicity + this.formulaWeights().sa,
  );
  readonly hasProjectLabel = computed<boolean>(() => this.workflow.projectLabel().trim() !== '');
  readonly hasQuickFillSaMethod = computed<boolean>(() => this.quickFillSaMethod() !== '');
  readonly canGenerateFromSelectedSmileit = computed<boolean>(
    () =>
      !this.quickFillLoading() &&
      !this.quickFillApplying() &&
      this.quickFillSmileitJobId().trim() !== '' &&
      this.hasProjectLabel() &&
      this.hasQuickFillSaMethod(),
  );
  readonly candidateReviewStep = signal<2 | 3 | 4>(2);
  readonly hasCandidateInput = computed<boolean>(() => {
    const hasTextPayload = [
      this.workflow.sourceConfigsJson(),
      this.workflow.smilesCsvText(),
      this.workflow.combinedCsvText(),
      this.workflow.toxicityCsvText(),
      this.workflow.saCsvText(),
    ].some((value) => value.trim() !== '');
    const hasFiles = [
      this.workflow.combinedFile(),
      this.workflow.smilesFile(),
      this.workflow.toxicityFile(),
      this.workflow.saFile(),
    ].some((value) => value !== null);

    return hasTextPayload || hasFiles;
  });
  readonly canAdvanceToFormulaStep = computed(
    () =>
      this.workflow.selectedReferenceLibraryId().trim() !== '' &&
      this.hasProjectLabel() &&
      (this.hasCandidateInput() ||
        this.workflow.resultData() !== null ||
        this.workflow.isProcessing()),
  );
  readonly activeStep = computed<1 | 2 | 3 | 4>(() => {
    if (this.workflow.selectedReferenceLibraryId() === '') {
      return 1;
    }

    const reviewStep = this.candidateReviewStep();
    if (reviewStep >= 4 && this.workflow.resultData() !== null) {
      return 4;
    }

    if (reviewStep >= 3 && this.canAdvanceToFormulaStep()) {
      return 3;
    }

    return 2;
  });
  /** Resumen del paso 1 para la barra de contexto en pasos 2–4. */
  readonly step1Summary = computed<string>(() => {
    const library = this.selectedLibrary();
    if (library === null) return '';
    const rowCount = library.rows?.length ?? 0;
    const disease = library.disease_name?.trim() || 'N/A';
    return `${library.name} · ${disease} · ${rowCount} compounds`;
  });

  /** Resumen del paso 2 para la barra de contexto en pasos 3–4. */
  readonly step2Summary = computed<string>(() => {
    const guideSummary = this.quickFillGuideSummary();
    if (guideSummary.hasGuide) {
      const parts: string[] = [];
      if (guideSummary.moleculeCount > 0) parts.push(`${guideSummary.moleculeCount} candidates`);
      if (guideSummary.hasToxicityData) parts.push('Toxicity');
      if (guideSummary.hasSaData) parts.push('SA');
      return parts.length > 0 ? parts.join(' · ') : 'Guide loaded';
    }

    const totalRows = this.candidateImportedTotalUsableRows();
    const totalFiles = this.candidateImportedTotalFiles();
    if (totalRows > 0 || totalFiles > 0) {
      return `${totalRows} candidates · ${totalFiles} file(s)`;
    }

    const hasCombined = this.workflow.combinedCsvText().trim() !== '';
    const hasSmiles = this.workflow.smilesCsvText().trim() !== '';
    if (hasCombined || hasSmiles) return 'CSV data loaded';

    return '';
  });

  readonly canPauseCurrentProgress = computed<boolean>(() => {
    const hasReference = this.workflow.selectedReferenceLibraryId().trim() !== '';
    const hasProjectLabel = this.workflow.projectLabel().trim() !== '';
    const hasMainGuide =
      this.workflow.sourceConfigsJson().trim() !== '' ||
      this.workflow.smilesCsvText().trim() !== '' ||
      this.workflow.combinedCsvText().trim() !== '';
    return hasReference && hasProjectLabel && hasMainGuide;
  });
  readonly quickFillAvailableSaMethods = computed<SaScoreMethod[]>(() => {
    const selectedJobId = this.quickFillSaScoreJobId().trim();
    if (selectedJobId === '') {
      return ['ambit', 'brsa', 'rdkit'];
    }

    const matchingJob = this.quickFillSaScoreJobs().find((job) => job.id === selectedJobId) ?? null;
    return extractRequestedSaMethods(matchingJob?.parameters);
  });
  readonly quickFillGuideSummary = computed(() =>
    inspectCadmaSourceConfigs(this.workflow.sourceConfigsJson()),
  );
  readonly candidatePayloadPreview = computed(() =>
    previewCadmaSourceConfigs(this.workflow.sourceConfigsJson(), 10),
  );
  readonly canApplyQuickFill = computed<boolean>(
    () =>
      !this.quickFillLoading() &&
      !this.quickFillApplying() &&
      this.quickFillSmileitJobId().trim() !== '' &&
      this.hasProjectLabel() &&
      this.hasQuickFillSaMethod(),
  );
  readonly canLaunchQuickFillFromCurrentGuide = computed<boolean>(() => {
    const guideSummary = this.quickFillGuideSummary();
    return (
      !this.quickFillLoading() &&
      !this.quickFillApplying() &&
      guideSummary.hasGuide &&
      this.hasProjectLabel() &&
      this.hasQuickFillSaMethod() &&
      (!guideSummary.hasToxicityData || !guideSummary.hasSaData)
    );
  });

  constructor() {
    this.refreshLibraries();
    this.refreshSamples();
    this.loadQuickFillJobs();

    effect(() => {
      const workflowConfigJson = this.workflow.scoreConfigJson().trim();
      if (workflowConfigJson !== '') {
        this.applyScoreConfigJson(workflowConfigJson);
        return;
      }

      const resultConfig = this.workflow.resultData()?.score_config ?? null;
      if (resultConfig !== null) {
        this.applyScoreConfig(resultConfig);
      }
    });
  }

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflow);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  loadQuickFillJobs(): void {
    this.quickFillLoading.set(true);
    this.quickFillErrorMessage.set(null);

    this.quickFillService.loadSourceJobs().subscribe({
      next: ({ smileitJobs, toxicityJobs, saScoreJobs }) => {
        this.quickFillLoading.set(false);
        this.quickFillSmileitJobs.set(smileitJobs);
        this.quickFillToxicityJobs.set(toxicityJobs);
        this.quickFillSaScoreJobs.set(saScoreJobs);
        this.quickFillSmileitJobId.set(
          pickPreferredHistoricalJobId(this.quickFillSmileitJobId(), smileitJobs),
        );
        this.quickFillToxicityJobId.set(
          pickPreferredHistoricalJobId(this.quickFillToxicityJobId(), toxicityJobs),
        );
        this.quickFillSaScoreJobId.set(
          pickPreferredHistoricalJobId(this.quickFillSaScoreJobId(), saScoreJobs),
        );

        const allowedMethods = this.quickFillAvailableSaMethods();
        const selectedMethod = this.quickFillSaMethod();
        if (selectedMethod !== '' && !allowedMethods.includes(selectedMethod)) {
          this.quickFillSaMethod.set('');
        }
      },
      error: (error: Error) => {
        this.quickFillLoading.set(false);
        this.quickFillErrorMessage.set(`Unable to load previous jobs: ${error.message}`);
      },
    });
  }

  updateQuickFillSmileitJob(jobId: string): void {
    this.quickFillSmileitJobId.set(jobId);
    this.quickFillSaMethod.set('');
    this.quickFillErrorMessage.set(null);
    this.applyDefaultProjectLabelFromSelectedJob(jobId);
  }

  updateQuickFillSaJob(jobId: string): void {
    this.quickFillSaScoreJobId.set(jobId);
    this.quickFillSaMethod.set('');
    this.quickFillErrorMessage.set(null);
  }

  updateQuickFillSaMethod(method: QuickFillSelectableSaMethod): void {
    this.quickFillSaMethod.set(method);
    this.quickFillErrorMessage.set(null);
  }

  updateFormulaInterval(
    metric: CadmaIntervalMetric,
    bound: 'min' | 'max',
    rawValue: string | number,
  ): void {
    this.legacyIntervals.update((currentIntervals) => {
      const currentRange = currentIntervals[metric];
      return {
        ...currentIntervals,
        [metric]: {
          ...currentRange,
          [bound]: toFiniteNumber(rawValue, currentRange[bound]),
        },
      };
    });
    this.syncScoreConfigToWorkflow();
  }

  updateFormulaReference(metric: CadmaFormulaMetric, rawValue: string | number): void {
    this.formulaReferences.update((currentValues) => ({
      ...currentValues,
      [metric]: toFiniteNumber(rawValue, currentValues[metric]),
    }));
    this.syncScoreConfigToWorkflow();
  }

  updateFormulaWeight(metric: CadmaWeightMetric, rawValue: string | number): void {
    this.formulaWeights.update((currentValues) => ({
      ...currentValues,
      [metric]: Math.max(0, toFiniteNumber(rawValue, currentValues[metric])),
    }));
    this.syncScoreConfigToWorkflow();
  }

  resetLegacyScoreConfig(): void {
    this.legacyIntervals.set(cloneLegacyIntervals());
    this.formulaWeights.set({ ...LEGACY_DEFAULT_WEIGHTS });
    this.formulaReferences.set(computeFormulaReferenceValues(this.selectedLibrary()?.rows ?? []));
    this.syncScoreConfigToWorkflow();
  }

  launchQuickFillFromSelectedSmileit(): void {
    if (this.quickFillSmileitJobId().trim() === '') {
      this.quickFillErrorMessage.set('Select a completed Smile-it job before generating reports.');
      return;
    }

    const selectedSaMethod = this.requireQuickFillSaMethod();
    if (selectedSaMethod === null) {
      return;
    }

    this.quickFillApplying.set(true);
    this.quickFillErrorMessage.set(null);
    this.candidateDraftMessage.set(
      'Generating Toxicity and SA Score reports from the selected Smile-it guide...',
    );

    this.quickFillService
      .launchAutoFillFromSmileitJob(this.quickFillSmileitJobId(), selectedSaMethod)
      .subscribe({
        next: (payload) => {
          this.quickFillApplying.set(false);
          this.candidateReviewStep.set(2);
          this.candidateBundle.set(createEmptyCsvBundle());
          this.workflow.clearCandidateInputs();
          this.workflow.sourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateSourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateImportedFilenames.set(payload.filenames);
          this.candidateImportedTotalFiles.set(payload.totalFiles);
          this.candidateImportedTotalUsableRows.set(payload.totalUsableRows);
          this.quickFillToxicityJobId.set(payload.launchedToxicityJobId);
          this.quickFillSaScoreJobId.set(payload.launchedSaScoreJobId);

          this.applyDefaultProjectLabelFromSourceConfigs(payload.sourceConfigsJson);

          this.candidateDraftMessage.set(
            'The Smile-it guide now includes the generated Toxicity and SA outputs. Review the formula and then plot the CADMA ranking.',
          );
          this.loadQuickFillJobs();
        },
        error: (error: Error) => {
          this.quickFillApplying.set(false);
          this.quickFillErrorMessage.set(
            `Unable to generate the Smile-it reports: ${error.message}`,
          );
          this.candidateDraftMessage.set('');
        },
      });
  }

  launchQuickFillFromCurrentGuide(): void {
    const guideSummary = this.quickFillGuideSummary();
    if (!guideSummary.hasGuide) {
      this.quickFillErrorMessage.set(
        'Upload a candidate guide with a name and SMILES column first.',
      );
      return;
    }

    const selectedSaMethod = this.requireQuickFillSaMethod();
    if (selectedSaMethod === null) {
      return;
    }

    if (guideSummary.hasToxicityData && guideSummary.hasSaData) {
      this.quickFillErrorMessage.set(
        'The candidate guide is already complete or is still being processed.',
      );
      return;
    }

    this.quickFillApplying.set(true);
    this.quickFillErrorMessage.set(null);
    this.candidateDraftMessage.set(
      'Launching SA Score and Toxicity predictions from the current candidate guide...',
    );

    this.quickFillService
      .launchAutoFillFromCurrentGuide(this.workflow.sourceConfigsJson(), selectedSaMethod)
      .subscribe({
        next: (payload) => {
          this.quickFillApplying.set(false);
          this.candidateReviewStep.set(2);
          this.candidateBundle.set(createEmptyCsvBundle());
          this.workflow.clearCandidateInputs();
          this.workflow.sourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateSourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateImportedFilenames.set(payload.filenames);
          this.candidateImportedTotalFiles.set(payload.totalFiles);
          this.candidateImportedTotalUsableRows.set(payload.totalUsableRows);

          if (payload.launchedToxicityJobId !== '') {
            this.quickFillToxicityJobId.set(payload.launchedToxicityJobId);
          }
          if (payload.launchedSaScoreJobId !== '') {
            this.quickFillSaScoreJobId.set(payload.launchedSaScoreJobId);
          }

          this.candidateDraftMessage.set(
            'Quick fill completed. LD50, mutagenicity/AMES, DevTox and the selected SA method were added to the candidate batch.',
          );
          this.loadQuickFillJobs();
        },
        error: (error: Error) => {
          this.quickFillApplying.set(false);
          this.quickFillErrorMessage.set(
            `Unable to launch the quick-fill predictions: ${error.message}`,
          );
          this.candidateDraftMessage.set('');
        },
      });
  }

  applyQuickFillFromPreviousJobs(): void {
    if (this.quickFillSmileitJobId().trim() === '') {
      this.quickFillErrorMessage.set('Select at least one completed Smile-it job.');
      return;
    }

    const selectedSaMethod = this.requireQuickFillSaMethod();
    if (selectedSaMethod === null) {
      return;
    }

    this.quickFillApplying.set(true);
    this.quickFillErrorMessage.set(null);
    this.candidateDraftMessage.set(
      'Preparing the CADMA guide from the selected Smile-it, Toxicity and SA Score jobs...',
    );

    this.quickFillService
      .buildAutoFillPayload({
        smileitJobId: this.quickFillSmileitJobId(),
        toxicityJobId: this.quickFillToxicityJobId() || undefined,
        saScoreJobId: this.quickFillSaScoreJobId() || undefined,
        saMethod: selectedSaMethod,
      })
      .subscribe({
        next: (payload) => {
          this.quickFillApplying.set(false);
          this.candidateReviewStep.set(2);
          this.candidateBundle.set(createEmptyCsvBundle());
          this.workflow.clearCandidateInputs();
          this.workflow.sourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateSourceConfigsJson.set(payload.sourceConfigsJson);
          this.candidateImportedFilenames.set(payload.filenames);
          this.candidateImportedTotalFiles.set(payload.totalFiles);
          this.candidateImportedTotalUsableRows.set(payload.totalUsableRows);

          this.applyDefaultProjectLabelFromSourceConfigs(payload.sourceConfigsJson);

          this.candidateDraftMessage.set(
            'Candidate inputs auto-filled. You can now run CADMA Py or save the paused draft before dispatching.',
          );
        },
        error: (error: Error) => {
          this.quickFillApplying.set(false);
          this.quickFillErrorMessage.set(`Unable to auto-fill candidate values: ${error.message}`);
          this.candidateDraftMessage.set('');
        },
      });
  }

  formatPreviewMetric(value: number | null, renderAsBoolean: boolean = false): string {
    if (value === null) {
      return '—';
    }

    if (renderAsBoolean && (value === 0 || value === 1)) {
      return value === 1 ? 'True' : 'False';
    }

    return value.toFixed(2);
  }

  quickFillJobLabel(job: ScientificJobView): string {
    return resolveScientificJobLabel(job);
  }

  private applyDefaultProjectLabelFromSelectedJob(jobId: string): void {
    if (this.workflow.projectLabel().trim() !== '') {
      return;
    }

    const selectedJob = this.quickFillSmileitJobs().find((job) => job.id === jobId) ?? null;
    if (selectedJob === null) {
      return;
    }

    const resolvedLabel = resolveScientificJobLabel(selectedJob).split(' · ')[0]?.trim() ?? '';
    if (resolvedLabel !== '') {
      this.workflow.projectLabel.set(resolvedLabel);
    }
  }

  private applyDefaultProjectLabelFromSourceConfigs(sourceConfigsJson: string): void {
    if (this.workflow.projectLabel().trim() !== '' || sourceConfigsJson.trim() === '') {
      return;
    }

    const preview = previewCadmaSourceConfigs(sourceConfigsJson, 1);
    const firstCandidate = preview.rows[0];
    const resolvedLabel = firstCandidate?.name?.trim() || firstCandidate?.smiles?.trim() || '';
    if (resolvedLabel !== '') {
      this.workflow.projectLabel.set(resolvedLabel);
    }
  }

  private requireQuickFillSaMethod(): SaScoreMethod | null {
    const selectedMethod = this.quickFillSaMethod();
    if (selectedMethod === '') {
      this.quickFillErrorMessage.set('Select the SA method before continuing.');
      return null;
    }
    return selectedMethod;
  }

  refreshLibraries(preferredLibraryId: string = '', revealCopiedLibrary: boolean = false): void {
    this.cadmaApi.listReferenceLibraries().subscribe({
      next: (libraries) => {
        this.libraries.set(libraries);

        const selectedId = this.workflow.selectedReferenceLibraryId();
        const transientLibrary = this.selectedTransientLibrary();
        if (
          selectedId &&
          !libraries.some((library) => library.id === selectedId) &&
          transientLibrary?.id !== selectedId
        ) {
          this.workflow.selectedReferenceLibraryId.set('');
        }

        const browsingId = this.browsingLibraryId();
        if (browsingId && !libraries.some((library) => library.id === browsingId)) {
          this.browsingLibraryId.set('');
        }

        if (
          revealCopiedLibrary &&
          preferredLibraryId !== '' &&
          libraries.some((library) => library.id === preferredLibraryId)
        ) {
          this.closeSampleBrowsing();
          this.previewLibraryId.set('');
          this.browsingLibraryId.set(preferredLibraryId);
          this.copiedLibraryId.set(preferredLibraryId);
        }
      },
      error: (error: Error) => {
        this.libraryErrorMessage.set(`Unable to load reference families: ${error.message}`);
      },
    });
  }

  handleLibraryChanged(updatedLibraryId?: string): void {
    this.refreshLibraries(updatedLibraryId ?? '');
  }

  handleCopiedLibraryCreated(newLibraryId: string): void {
    this.refreshLibraries(newLibraryId, true);
  }

  refreshSamples(): void {
    this.cadmaApi.listReferenceSamples().subscribe({
      next: (samples) => this.samples.set(samples),
      error: () => {
        this.samples.set([]);
      },
    });
  }

  togglePreview(libraryId: string, event: Event): void {
    event.stopPropagation();
    this.previewLibraryId.set(this.previewLibraryId() === libraryId ? '' : libraryId);
  }

  toggleSamplePreview(sampleKey: string, event: Event): void {
    event.stopPropagation();
    this.browseSample(sampleKey);
  }

  browseSample(sampleKey: string): void {
    if (this.browsingSampleKey() === sampleKey) {
      this.closeSampleBrowsing();
      return;
    }

    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.previewSampleKey.set(sampleKey);
    this.browsingSampleKey.set(sampleKey);
    this.browsingSampleLibrary.set(null);
    this.samplePreviewRows.set([]);

    this.cadmaApi.previewReferenceSampleDetail(sampleKey).subscribe({
      next: (library) => this.browsingSampleLibrary.set(library),
      error: () => {
        this.browsingSampleLibrary.set(null);
        this.libraryErrorMessage.set('Unable to load the full bundled reference detail.');
      },
    });
  }

  closeSampleBrowsing(): void {
    this.previewSampleKey.set('');
    this.browsingSampleKey.set('');
    this.browsingSampleLibrary.set(null);
    this.samplePreviewRows.set([]);
  }

  deleteLibrary(library: CadmaReferenceLibraryView, event: Event): void {
    event.stopPropagation();
    if (!library.deletable) return;
    this.openDeleteModal(library.id, library.name);
  }

  /** Solicita la vista previa de eliminación y abre el modal. */
  private openDeleteModal(libraryId: string, libraryName: string): void {
    this.deleteModalLibraryId.set(libraryId);
    this.deleteModalLibraryName.set(libraryName);
    this.deleteModalLinkedJobs.set([]);
    this.deleteModalLoading.set(true);
    this.libraryErrorMessage.set(null);
    this.deleteModal?.open();

    this.cadmaApi.previewLibraryDeletion(libraryId).subscribe({
      next: (preview) => {
        this.deleteModalLinkedJobs.set(preview.linked_jobs);
        this.deleteModalLoading.set(false);
        this.deleteModal?.errorMessage.set(null);
      },
      error: (error: Error) => {
        this.deleteModalLoading.set(false);
        this.deleteModalLinkedJobs.set([]);
        this.deleteModal?.errorMessage.set(
          `Unable to inspect linked jobs before deletion: ${error.message}`,
        );
      },
    });
  }

  /** Callback del modal tras confirmar la eliminación. */
  confirmDelete(result: DeleteConfirmationResult): void {
    if (!result.confirmed) return;
    const libraryId = this.deleteModalLibraryId();
    if (!libraryId) return;

    const shouldCascade = result.cascade || this.deleteModalLinkedJobs().length > 0;
    this.submitDeleteRequest(libraryId, shouldCascade, false);
  }

  /** Ejecuta la eliminación y reintenta con cascade si el backend detecta jobs asociados. */
  private submitDeleteRequest(libraryId: string, cascade: boolean, alreadyRetried: boolean): void {
    this.deleteModal?.deleting.set(true);
    this.deleteModal?.errorMessage.set(null);

    this.cadmaApi.deleteReferenceLibrary(libraryId, cascade).subscribe({
      next: () => {
        this.deleteModal?.deleting.set(false);
        this.deleteModal?.close();
        this.previewLibraryId.set('');
        if (this.workflow.selectedReferenceLibraryId() === libraryId) {
          this.resetReferenceForm();
        }
        this.refreshLibraries();
      },
      error: (error: Error) => {
        const message = error.message ?? 'Unable to delete the selected family.';
        const requiresCascade = /cascade=true|jobs asociados|linked jobs/i.test(message);
        if (!alreadyRetried && !cascade && requiresCascade) {
          this.submitDeleteRequest(libraryId, true, true);
          return;
        }

        this.deleteModal?.deleting.set(false);
        this.deleteModal?.errorMessage.set(message);
      },
    });
  }

  /** Callback del modal al cancelar la eliminación. */
  onDeleteDismissed(): void {
    this.deleteModalLibraryId.set('');
    this.deleteModalLibraryName.set('');
    this.deleteModalLinkedJobs.set([]);
  }

  /** Abre el detalle completo de una familia para explorar antes de seleccionar. */
  browseLibrary(libraryId: string): void {
    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set(this.browsingLibraryId() === libraryId ? '' : libraryId);
  }

  closeBrowsing(): void {
    this.browsingLibraryId.set('');
  }

  /** Confirma la familia en exploración como referencia seleccionada. */
  confirmBrowsingSelection(): void {
    const sampleKey = this.browsingSampleKey();
    if (sampleKey) {
      this.closeSampleBrowsing();
      this.selectBundledSample(sampleKey);
      return;
    }

    const id = this.browsingLibraryId();
    if (id) {
      this.browsingLibraryId.set('');
      this.selectLibrary(id);
    }
  }

  selectLibrary(libraryId: string, libraryOverride: CadmaReferenceLibraryView | null = null): void {
    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.candidateReviewStep.set(2);
    this.workflow.selectedReferenceLibraryId.set(libraryId);

    const library =
      libraryOverride ?? this.libraries().find((item) => item.id === libraryId) ?? null;
    this.selectedTransientLibrary.set(libraryOverride);
    if (library === null) {
      return;
    }

    this.libraryName.set(library.name);
    this.diseaseName.set(library.disease_name);
    this.description.set(library.description);
    this.paperReference.set(library.paper_reference);
    this.paperUrl.set(library.paper_url);
    this.resetLegacyScoreConfig();
  }

  resetReferenceForm(): void {
    this.candidateReviewStep.set(2);
    this.workflow.selectedReferenceLibraryId.set('');
    this.selectedTransientLibrary.set(null);
    this.libraryName.set('');
    this.diseaseName.set('');
    this.description.set('');
    this.paperReference.set('');
    this.paperUrl.set('');
    this.referenceBundle.set(createEmptyCsvBundle());
    this.referenceSourceConfigsJson.set('');
    this.libraryErrorMessage.set(null);
    this.legacyIntervals.set(cloneLegacyIntervals());
    this.formulaReferences.set({ ...LEGACY_DEFAULT_REFERENCES });
    this.formulaWeights.set({ ...LEGACY_DEFAULT_WEIGHTS });
    this.workflow.scoreConfigJson.set('');
  }

  async onReferenceFileChange(kind: CsvKind, event: Event): Promise<void> {
    await this.readCsvIntoBundle(kind, event, this.referenceBundle);
  }

  async onCandidateFileChange(kind: CsvKind, event: Event): Promise<void> {
    await this.readCsvIntoBundle(kind, event, this.candidateBundle);
    const bundle = this.candidateBundle();
    this.workflow.combinedCsvText.set(bundle.combined);
    this.workflow.smilesCsvText.set(bundle.smiles);
    this.workflow.toxicityCsvText.set(bundle.toxicity);
    this.workflow.saCsvText.set(bundle.sa);
    this.workflow.combinedFile.set(bundle.combinedFile);
    this.workflow.smilesFile.set(bundle.smilesFile);
    this.workflow.toxicityFile.set(bundle.toxicityFile);
    this.workflow.saFile.set(bundle.saFile);
    this.workflow.sourceConfigsJson.set('');
    this.candidateSourceConfigsJson.set('');
  }

  async saveReferenceLibrary(): Promise<void> {
    this.isBusy.set(true);
    this.libraryErrorMessage.set(null);

    const referenceBundle = this.referenceBundle();
    const payload = {
      name: this.libraryName().trim(),
      disease_name: this.diseaseName().trim(),
      description: this.description().trim(),
      paper_reference: this.paperReference().trim(),
      paper_url: this.paperUrl().trim(),
      combined_csv_text: referenceBundle.combined,
      smiles_csv_text: referenceBundle.smiles,
      toxicity_csv_text: referenceBundle.toxicity,
      sa_csv_text: referenceBundle.sa,
      combined_file: referenceBundle.combinedFile,
      smiles_file: referenceBundle.smilesFile,
      toxicity_file: referenceBundle.toxicityFile,
      sa_file: referenceBundle.saFile,
      source_configs_json: this.referenceSourceConfigsJson(),
    };

    const selectedLibrary = this.selectedLibrary();
    const request$ =
      selectedLibrary?.editable === true
        ? this.cadmaApi.updateReferenceLibrary(selectedLibrary.id, payload)
        : this.cadmaApi.createReferenceLibrary(payload);

    request$.subscribe({
      next: (library) => {
        this.isBusy.set(false);
        this.refreshLibraries();
        this.selectLibrary(library.id);
      },
      error: (error: Error) => {
        this.isBusy.set(false);
        this.libraryErrorMessage.set(error.message);
      },
    });
  }

  deleteSelectedLibrary(): void {
    const selectedLibrary = this.selectedLibrary();
    if (selectedLibrary?.deletable !== true) {
      return;
    }
    this.openDeleteModal(selectedLibrary.id, selectedLibrary.name);
  }

  clearReferenceSelection(): void {
    this.resetReferenceForm();
    this.workflow.clearCandidateInputs();
    this.candidateBundle.set(createEmptyCsvBundle());
    this.candidateImportedFilenames.set([]);
    this.candidateImportedTotalFiles.set(0);
    this.candidateImportedTotalUsableRows.set(0);
    this.candidateDraftMessage.set('');
    this.showCreateForm.set(false);
  }

  selectBundledSample(sampleKey: string): void {
    const prefetchedLibrary =
      this.browsingSampleKey() === sampleKey ? this.browsingSampleLibrary() : null;
    if (prefetchedLibrary !== null) {
      this.selectLibrary(prefetchedLibrary.id, prefetchedLibrary);
      return;
    }

    this.isBusy.set(true);
    this.libraryErrorMessage.set(null);
    this.cadmaApi.previewReferenceSampleDetail(sampleKey).subscribe({
      next: (library) => {
        this.isBusy.set(false);
        this.selectLibrary(library.id, library);
      },
      error: (error: Error) => {
        this.isBusy.set(false);
        this.libraryErrorMessage.set(error.message);
      },
    });
  }

  acceptCandidateInputs(): void {
    if (!this.canAdvanceToFormulaStep()) {
      this.candidateDraftMessage.set(
        'Load or generate the candidate data first, then accept it to continue to step 3.',
      );
      return;
    }

    this.candidateReviewStep.set(3);
    this.candidateDraftMessage.set(
      'Candidate data accepted. Step 3 is now enabled with the frozen values.',
    );
  }

  returnToCandidateInputs(): void {
    this.candidateReviewStep.set(2);
    this.candidateDraftMessage.set(
      'You can review the imported candidate data again before accepting the batch.',
    );
  }

  runComparison(): void {
    const selectedLibraryId = this.workflow.selectedReferenceLibraryId().trim();
    if (selectedLibraryId === '') {
      this.libraryErrorMessage.set('Select a reference family before running the comparison.');
      return;
    }

    if (this.workflow.projectLabel().trim() === '') {
      this.candidateDraftMessage.set(
        'Project label is required before saving or running because it names the job.',
      );
      return;
    }

    this.candidateReviewStep.set(4);
    this.candidateDraftMessage.set('');
    this.syncScoreConfigToWorkflow();
    this.workflow.dispatch();
  }

  clearCandidateFiles(): void {
    this.candidateReviewStep.set(2);
    this.candidateBundle.set(createEmptyCsvBundle());
    this.candidateSourceConfigsJson.set('');
    this.candidateImportedFilenames.set([]);
    this.candidateImportedTotalFiles.set(0);
    this.candidateImportedTotalUsableRows.set(0);
    this.candidateDraftMessage.set('');
    this.workflow.clearCandidateInputs();
  }

  savePausedProgress(): void {
    if (this.workflow.projectLabel().trim() === '') {
      this.candidateDraftMessage.set(
        'Project label is required before saving or running because it names the job.',
      );
      return;
    }

    if (this.workflow.selectedReferenceLibraryId().trim() === '') {
      this.candidateDraftMessage.set('Select a reference family before saving the draft.');
      return;
    }

    const hasMainGuide =
      this.workflow.sourceConfigsJson().trim() !== '' ||
      this.workflow.smilesCsvText().trim() !== '' ||
      this.workflow.combinedCsvText().trim() !== '';
    if (!hasMainGuide) {
      this.candidateDraftMessage.set('Add the main SMILES guide before pausing the draft.');
      return;
    }

    const selectedLibrary = this.selectedLibrary();
    const previousDraftId = this.workflow.resumedDraftId().trim();
    const filenames =
      this.candidateImportedFilenames().length > 0
        ? this.candidateImportedFilenames()
        : [
            this.candidateBundle().combinedName,
            this.candidateBundle().smilesName,
            this.candidateBundle().toxicityName,
            this.candidateBundle().saName,
          ].filter((filename) => filename.trim() !== '');
    const totalFiles =
      this.candidateImportedTotalFiles() > 0
        ? this.candidateImportedTotalFiles()
        : filenames.length;

    this.isBusy.set(true);
    this.syncScoreConfigToWorkflow();
    this.candidateDraftMessage.set('Saving paused work in Jobs Monitor...');
    this.cadmaApi
      .createComparisonJob({
        reference_library_id: this.workflow.selectedReferenceLibraryId().trim(),
        project_label: this.workflow.projectLabel().trim(),
        combined_csv_text: this.workflow.combinedCsvText(),
        smiles_csv_text: this.workflow.smilesCsvText(),
        toxicity_csv_text: this.workflow.toxicityCsvText(),
        sa_csv_text: this.workflow.saCsvText(),
        combined_file: this.workflow.combinedFile(),
        smiles_file: this.workflow.smilesFile(),
        toxicity_file: this.workflow.toxicityFile(),
        sa_file: this.workflow.saFile(),
        source_configs_json: this.workflow.sourceConfigsJson(),
        score_config_json: this.workflow.scoreConfigJson(),
        start_paused: true,
      })
      .subscribe({
        next: (pausedJob) => {
          this.isBusy.set(false);
          if (previousDraftId !== '' && previousDraftId !== pausedJob.id) {
            this.workflow.deletePausedDraft(previousDraftId);
          }

          const nextDraft = this.workflow.savePausedDraft(
            {
              referenceLibraryId: this.workflow.selectedReferenceLibraryId().trim(),
              referenceLibraryName: selectedLibrary?.name ?? 'Selected reference family',
              projectLabel: this.workflow.projectLabel().trim(),
              combinedCsvText: this.workflow.combinedCsvText(),
              smilesCsvText: this.workflow.smilesCsvText(),
              toxicityCsvText: this.workflow.toxicityCsvText(),
              saCsvText: this.workflow.saCsvText(),
              sourceConfigsJson: this.workflow.sourceConfigsJson(),
              scoreConfigJson: this.workflow.scoreConfigJson(),
              filenames,
              totalFiles,
              totalUsableRows: this.candidateImportedTotalUsableRows(),
            },
            pausedJob.id,
          );

          this.workflow.loadHistory();
          this.candidateDraftMessage.set(
            `Paused job saved for ${nextDraft.projectLabel} and listed in Jobs Monitor.`,
          );
        },
        error: (saveError: Error) => {
          this.isBusy.set(false);
          this.candidateDraftMessage.set(`Unable to save the paused job: ${saveError.message}`);
        },
      });
  }

  resumePausedProgress(draftId: string): void {
    const resumedDraft = this.workflow.resumePausedDraft(draftId);
    if (resumedDraft === null) {
      this.candidateDraftMessage.set('The selected paused draft is no longer available.');
      return;
    }

    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.candidateReviewStep.set(2);
    this.showCreateForm.set(false);
    this.candidateSourceConfigsJson.set(resumedDraft.sourceConfigsJson);
    this.candidateImportedFilenames.set(resumedDraft.filenames);
    this.candidateImportedTotalFiles.set(resumedDraft.totalFiles);
    this.candidateImportedTotalUsableRows.set(resumedDraft.totalUsableRows);

    const matchingLibrary = this.libraries().find(
      (library) => library.id === resumedDraft.referenceLibraryId,
    );
    if (matchingLibrary !== undefined) {
      this.selectLibrary(matchingLibrary.id);
    }

    this.candidateDraftMessage.set(`Resumed paused draft for ${resumedDraft.projectLabel}.`);
  }

  deletePausedProgress(draftId: string): void {
    this.workflow.deletePausedDraft(draftId);
    this.candidateDraftMessage.set('Paused draft removed.');
  }

  onReferenceImportChanged(state: CadmaImportStateChange): void {
    this.referenceSourceConfigsJson.set(state.sourceConfigsJson);
    if (state.sourceConfigsJson.trim() !== '') {
      this.referenceBundle.set(createEmptyCsvBundle());
    }
  }

  onCandidateImportChanged(state: CadmaImportStateChange): void {
    this.candidateReviewStep.set(2);
    this.candidateSourceConfigsJson.set(state.sourceConfigsJson);
    this.candidateImportedFilenames.set(state.filenames);
    this.candidateImportedTotalFiles.set(state.totalFiles);
    this.candidateImportedTotalUsableRows.set(state.totalUsableRows);
    this.workflow.sourceConfigsJson.set(state.sourceConfigsJson);
    if (state.sourceConfigsJson.trim() !== '') {
      this.candidateBundle.set(createEmptyCsvBundle());
      this.workflow.combinedCsvText.set('');
      this.workflow.smilesCsvText.set('');
      this.workflow.toxicityCsvText.set('');
      this.workflow.saCsvText.set('');
      this.workflow.combinedFile.set(null);
      this.workflow.smilesFile.set(null);
      this.workflow.toxicityFile.set(null);
      this.workflow.saFile.set(null);
      this.applyDefaultProjectLabelFromSourceConfigs(state.sourceConfigsJson);
    }
  }

  openHistoricalJob(jobId: string): void {
    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.candidateReviewStep.set(4);
    this.workflow.openHistoricalJob(jobId);
  }

  /** Regresa al paso 3 (fórmula) desde el paso 4 (resultados). */
  returnToFormulaStep(): void {
    this.candidateReviewStep.set(3);
    this.candidateDraftMessage.set(
      'Back to formula configuration. Adjust parameters and run again.',
    );
  }

  readonly resolveHistoryJobDisplayName = (historyJob: {
    id: string;
    parameters: unknown;
  }): string => {
    const parameters = historyJob.parameters;
    if (parameters !== null && typeof parameters === 'object' && !Array.isArray(parameters)) {
      const parameterRecord = parameters as Record<string, unknown>;
      const projectLabel = parameterRecord['project_label'];
      if (typeof projectLabel === 'string' && projectLabel.trim() !== '') {
        return projectLabel.trim();
      }

      const referenceLibraryId = parameterRecord['reference_library_id'];
      if (typeof referenceLibraryId === 'string' && referenceLibraryId.trim() !== '') {
        const matchingLibrary = this.libraries().find(
          (library) => library.id === referenceLibraryId,
        );
        if (matchingLibrary !== undefined) {
          return `${matchingLibrary.name} comparison`;
        }
      }
    }

    return historyJob.id;
  };

  exportSelectionCsv(): void {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return;
    }

    const header = [
      'name',
      'smiles',
      'selection_score',
      'adme_alignment',
      'toxicity_alignment',
      'sa_alignment',
      'adme_hits_in_band',
      'MW',
      'logP',
      'MR',
      'AtX',
      'HBLA',
      'HBLD',
      'RB',
      'PSA',
      'DT',
      'M',
      'LD50',
      'SA',
      'metrics_in_band',
      'best_fit_summary',
    ];
    const rows = resultData.ranking.map((row) =>
      [
        row.name,
        row.smiles,
        row.selection_score.toFixed(4),
        row.adme_alignment.toFixed(4),
        row.toxicity_alignment.toFixed(4),
        row.sa_alignment.toFixed(4),
        row.adme_hits_in_band.toString(),
        row.MW?.toFixed(4) ?? '',
        row.logP?.toFixed(4) ?? '',
        row.MR?.toFixed(4) ?? '',
        row.AtX?.toFixed(4) ?? '',
        row.HBLA?.toFixed(4) ?? '',
        row.HBLD?.toFixed(4) ?? '',
        row.RB?.toFixed(4) ?? '',
        row.PSA?.toFixed(4) ?? '',
        row.DT?.toFixed(4) ?? '',
        row.M?.toFixed(4) ?? '',
        row.LD50?.toFixed(4) ?? '',
        row.SA?.toFixed(4) ?? '',
        row.metrics_in_band.join('|'),
        row.best_fit_summary,
      ].join(','),
    );

    downloadBlobFile(
      'cadma_py_selection_scores.csv',
      new Blob([[header.join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
  }

  private syncScoreConfigToWorkflow(): void {
    this.workflow.scoreConfigJson.set(JSON.stringify(this.buildScoreConfig()));
  }

  private buildScoreConfig(): CadmaScoreConfigView {
    const weights = this.formulaWeights();
    return {
      adme_intervals: this.legacyIntervals(),
      weights: {
        adme: Number(weights.adme.toFixed(4)),
        toxicity: Number(weights.toxicity.toFixed(4)),
        sa: Number(weights.sa.toFixed(4)),
      },
      reference_values: this.formulaReferences(),
      adme_reference_hits: this.workflow.resultData()?.score_config?.adme_reference_hits ?? 8,
    };
  }

  private applyScoreConfig(config: CadmaScoreConfigView): void {
    const nextIntervals = cloneLegacyIntervals();
    for (const metric of LEGACY_INTERVAL_ORDER) {
      const interval = config.adme_intervals?.[metric];
      if (interval !== undefined) {
        nextIntervals[metric] = {
          min: toFiniteNumber(interval.min, nextIntervals[metric].min),
          max: toFiniteNumber(interval.max, nextIntervals[metric].max),
        };
      }
    }

    this.legacyIntervals.set(nextIntervals);
    this.formulaReferences.set({
      LD50: toFiniteNumber(config.reference_values?.LD50 ?? 0, LEGACY_DEFAULT_REFERENCES.LD50),
      M: toFiniteNumber(config.reference_values?.M ?? 0, LEGACY_DEFAULT_REFERENCES.M),
      DT: toFiniteNumber(config.reference_values?.DT ?? 0, LEGACY_DEFAULT_REFERENCES.DT),
      SA: toFiniteNumber(config.reference_values?.SA ?? 0, LEGACY_DEFAULT_REFERENCES.SA),
    });
    this.formulaWeights.set({
      adme: Math.max(0, toFiniteNumber(config.weights?.adme ?? 0, LEGACY_DEFAULT_WEIGHTS.adme)),
      toxicity: Math.max(
        0,
        toFiniteNumber(config.weights?.toxicity ?? 0, LEGACY_DEFAULT_WEIGHTS.toxicity),
      ),
      sa: Math.max(0, toFiniteNumber(config.weights?.sa ?? 0, LEGACY_DEFAULT_WEIGHTS.sa)),
    });
  }

  private applyScoreConfigJson(rawJson: string): void {
    try {
      const parsedValue: unknown = JSON.parse(rawJson);
      if (parsedValue !== null && typeof parsedValue === 'object' && !Array.isArray(parsedValue)) {
        this.applyScoreConfig(parsedValue as CadmaScoreConfigView);
      }
    } catch {
      // Ignorar JSON incompleto proveniente de borradores antiguos.
    }
  }

  private async readCsvIntoBundle(
    kind: CsvKind,
    event: Event,
    target: {
      (): CsvBundle;
      update(updateFn: (currentValue: CsvBundle) => CsvBundle): void;
    },
  ): Promise<void> {
    const inputElement = event.target as HTMLInputElement | null;
    const selectedFile = inputElement?.files?.item(0) ?? null;
    if (selectedFile === null) {
      return;
    }

    const fileText = await selectedFile.text();
    target.update(
      (currentValue) =>
        ({
          ...currentValue,
          [kind]: fileText,
          [`${kind}File`]: selectedFile,
          [`${kind}Name`]: selectedFile.name,
        }) as CsvBundle,
    );
  }

  scopeIcon(sourceReference: string): string {
    if (sourceReference === 'root') return '🌐';
    if (sourceReference.startsWith('admin-')) return '👥';
    if (sourceReference === 'local-lab') return '👤';
    return '❓';
  }

  scopeLabel(sourceReference: string): string {
    if (sourceReference === 'root') return 'Root';
    if (sourceReference.startsWith('admin-')) return 'Group';
    if (sourceReference === 'local-lab') return 'Personal';
    return '';
  }

  scopeCssClass(sourceReference: string): string {
    if (sourceReference === 'root') return 'scope-root';
    if (sourceReference.startsWith('admin-')) return 'scope-group';
    if (sourceReference === 'local-lab') return 'scope-personal';
    return 'scope-unknown';
  }
}

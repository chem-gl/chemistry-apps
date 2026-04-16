// cadma-py.component.ts: Interfaz principal de CADMA Py para familias de referencia, scoring y gráficas.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { Subscription } from 'rxjs';
import {
  CadmaMetricChartView,
  CadmaPyApiService,
  CadmaReferenceLibraryView,
  CadmaReferenceSampleView,
  CadmaSamplePreviewRowView,
} from '../core/api/cadma-py-api.service';
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
    ScientificChartComponent,
    JobLogsPanelComponent,
    JobHistoryTableComponent,
    CadmaPyFamilyDetailComponent,
    CadmaPyImporterComponent,
  ],
  providers: [CadmaPyWorkflowService],
  templateUrl: './cadma-py.component.html',
  styleUrl: './cadma-py.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyComponent implements OnInit, OnDestroy {
  private readonly cadmaApi = inject(CadmaPyApiService);
  private readonly route = inject(ActivatedRoute);
  readonly workflow = inject(CadmaPyWorkflowService);
  private routeSubscription: Subscription | null = null;

  readonly libraries = signal<CadmaReferenceLibraryView[]>([]);
  readonly samples = signal<CadmaReferenceSampleView[]>([]);
  readonly isBusy = signal<boolean>(false);
  readonly libraryErrorMessage = signal<string | null>(null);

  readonly libraryName = signal<string>('');
  readonly diseaseName = signal<string>('');
  readonly description = signal<string>('');
  readonly paperReference = signal<string>('');
  readonly paperUrl = signal<string>('');
  readonly selectedMetric = signal<string>('MW');
  readonly scoreChartType = signal<'bar' | 'line' | 'scatter'>('bar');
  readonly metricChartType = signal<'bar' | 'line' | 'scatter'>('bar');

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
    return this.libraries().find((library) => library.id === selectedId) ?? null;
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
  readonly activeStep = computed<1 | 2 | 3>(() => {
    if (this.workflow.resultData() !== null) return 3;
    if (this.workflow.selectedReferenceLibraryId() !== '') return 2;
    return 1;
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

  constructor() {
    this.refreshLibraries();
    this.refreshSamples();
  }

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflow);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  refreshLibraries(preferredLibraryId: string = '', revealCopiedLibrary: boolean = false): void {
    this.cadmaApi.listReferenceLibraries().subscribe({
      next: (libraries) => {
        this.libraries.set(libraries);

        const selectedId = this.workflow.selectedReferenceLibraryId();
        if (selectedId && !libraries.some((library) => library.id === selectedId)) {
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

    this.isBusy.set(true);
    this.libraryErrorMessage.set(null);
    this.cadmaApi.deleteReferenceLibrary(library.id).subscribe({
      next: () => {
        this.isBusy.set(false);
        this.previewLibraryId.set('');
        if (this.workflow.selectedReferenceLibraryId() === library.id) {
          this.resetReferenceForm();
        }
        this.refreshLibraries();
      },
      error: (error: Error) => {
        this.isBusy.set(false);
        this.libraryErrorMessage.set(error.message);
      },
    });
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
      this.importSample(sampleKey);
      return;
    }

    const id = this.browsingLibraryId();
    if (id) {
      this.browsingLibraryId.set('');
      this.selectLibrary(id);
    }
  }

  selectLibrary(libraryId: string): void {
    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.workflow.selectedReferenceLibraryId.set(libraryId);
    const library = this.libraries().find((item) => item.id === libraryId) ?? null;
    if (library === null) {
      return;
    }

    this.libraryName.set(library.name);
    this.diseaseName.set(library.disease_name);
    this.description.set(library.description);
    this.paperReference.set(library.paper_reference);
    this.paperUrl.set(library.paper_url);
  }

  resetReferenceForm(): void {
    this.workflow.selectedReferenceLibraryId.set('');
    this.libraryName.set('');
    this.diseaseName.set('');
    this.description.set('');
    this.paperReference.set('');
    this.paperUrl.set('');
    this.referenceBundle.set(createEmptyCsvBundle());
    this.referenceSourceConfigsJson.set('');
    this.libraryErrorMessage.set(null);
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

    this.isBusy.set(true);
    this.libraryErrorMessage.set(null);
    this.cadmaApi.deleteReferenceLibrary(selectedLibrary.id).subscribe({
      next: () => {
        this.isBusy.set(false);
        this.resetReferenceForm();
        this.refreshLibraries();
      },
      error: (error: Error) => {
        this.isBusy.set(false);
        this.libraryErrorMessage.set(error.message);
      },
    });
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

  importSample(sampleKey: string): void {
    this.isBusy.set(true);
    this.libraryErrorMessage.set(null);
    this.cadmaApi.importReferenceSample(sampleKey).subscribe({
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

    this.candidateDraftMessage.set('');
    this.workflow.dispatch();
  }

  clearCandidateFiles(): void {
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
    }
  }

  openHistoricalJob(jobId: string): void {
    this.closeSampleBrowsing();
    this.previewLibraryId.set('');
    this.browsingLibraryId.set('');
    this.workflow.openHistoricalJob(jobId);
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
      ].join(','),
    );

    downloadBlobFile(
      'cadma_py_selection_scores.csv',
      new Blob([[header.join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
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

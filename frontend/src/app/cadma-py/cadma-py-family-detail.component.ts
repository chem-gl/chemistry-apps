// cadma-py-family-detail.component.ts: Detalle expandible de una familia de referencia CADMA Py.
// Muestra promedios por métrica, trazabilidad, scope de permisos, tabla de compuestos
// con edición inline de referencias documentales y formulario para agregar compuestos.

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CadmaCompoundAddPayload,
  CadmaPyApiService,
  CadmaReferenceLibraryView,
  CadmaReferenceLibraryWritePayload,
  CadmaReferenceRowPatchPayload,
  CadmaReferenceRowView,
} from '../core/api/cadma-py-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import { ScientificChartComponent } from '../core/shared/components/scientific-chart/scientific-chart.component';
import {
  closeDialogOnBackdropClick,
  downloadBlobFile,
} from '../core/shared/scientific-app-ui.utils';
import { buildCadmaBoxplotOptions, getReferenceBoxplotMetricDefs, type BoxplotMetricDef } from './cadma-py-chart.options';

const ADME_LABELS: Record<string, string> = {
  MW: 'MW',
  logP: 'LogP',
  MR: 'MR',
  AtX: 'AtX',
  HBLA: 'HBLA',
  HBLD: 'HBLD',
  RB: 'RB',
  PSA: 'PSA',
};

const ADME_FULL_LABELS: Record<string, string> = {
  MW: 'Molar Mass',
  logP: 'LogP',
  MR: 'Molar Refractivity',
  AtX: 'Heavy Atoms',
  HBLA: 'HB Acceptors',
  HBLD: 'HB Donors',
  RB: 'Rotatable Bonds',
  PSA: 'Polar SA',
};

const ADME_KEYS = Object.keys(ADME_LABELS);

const TOXICITY_METRICS = [
  { key: 'DT', label: 'Dev. Toxicity', software: ['DT', 'DT_admet'] as const, suffixes: ['T.E.S.T.', 'ADMET-AI'] },
  { key: 'M', label: 'Mutagenicity', software: ['M', 'M_admet'] as const, suffixes: ['T.E.S.T.', 'ADMET-AI'] },
  { key: 'LD50', label: 'LD50 (mg/kg)', software: ['LD50', 'LD50_admet'] as const, suffixes: ['T.E.S.T.', 'ADMET-AI'] },
] as const;

const SA_METRIC = {
  key: 'SA', label: 'SA Score',
  software: ['SA_rdkit', 'SA_brsa', 'SA_ambit'] as const,
  suffixes: ['RDKit', 'BRSA', 'AMBIT'],
} as const;

const TABLE_METRICS: TableMetricDef[] = [
  ...(Object.entries(ADME_FULL_LABELS).map(([key, label]) => ({ key, label }))),
  { key: 'DT', label: 'Dev. Toxicity', sources: [{ field: 'DT', label: 'T.E.S.T.' }, { field: 'DT_admet', label: 'ADMET-AI' }] },
  { key: 'M', label: 'Mutagenicity', sources: [{ field: 'M', label: 'T.E.S.T.' }, { field: 'M_admet', label: 'ADMET-AI' }] },
  { key: 'LD50', label: 'LD50 (mg/kg)', sources: [{ field: 'LD50', label: 'T.E.S.T.' }, { field: 'LD50_admet', label: 'ADMET-AI' }] },
  { key: 'SA', label: 'SA Score', sources: [{ field: 'SA_rdkit', label: 'RDKit' }, { field: 'SA_brsa', label: 'BRSA' }, { field: 'SA_ambit', label: 'AMBIT' }] },
];

const CSV_EXPORT_KEYS: Array<keyof CadmaReferenceRowView> = [
  'name',
  'smiles',
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
  'paper_reference',
  'paper_url',
  'evidence_note',
];

export interface MetricStat {
  key: string;
  label: string;
  source: string;
  mean: number;
  stdev: number;
  min: number;
  max: number;
  nullCount: number;
  total: number;
}

interface TableMetricDef {
  key: string;
  label: string;
  sources?: Array<{ field: string; label: string }>;
}

export interface FamilyMetadataDraft {
  name: string;
  disease_name: string;
  description: string;
  paper_reference: string;
  paper_url: string;
}

export type ScopeKind = 'root' | 'group' | 'personal' | 'unknown';

function computeScopeKind(sourceReference: string): ScopeKind {
  if (sourceReference === 'root') return 'root';
  if (sourceReference.startsWith('admin-')) return 'group';
  if (sourceReference === 'local-lab') return 'personal';
  return 'unknown';
}

function _calcStats(values: number[], total: number) {
  const nullCount = total - values.length;
  if (values.length === 0) {
    return { mean: 0, stdev: 0, min: 0, max: 0, nullCount, total };
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  return {
    mean,
    stdev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    nullCount,
    total,
  };
}

function computeMetricStats(rows: CadmaReferenceRowView[]): MetricStat[] {
  const total = rows.length;
  return TABLE_METRICS.flatMap((def) => {
    if (!def.sources) {
      const key = def.key as keyof CadmaReferenceRowView;
      const values = rows
        .map((r) => r[key] as number | null | undefined)
        .filter((v): v is number => v != null && !Number.isNaN(v));
      return [{ key: def.key, label: def.label, source: '', ..._calcStats(values, total) }];
    }
    return def.sources.map((src) => {
      const field = src.field as keyof CadmaReferenceRowView;
      const values = rows
        .map((r) => r[field] as number | null | undefined)
        .filter((v): v is number => v != null && !Number.isNaN(v));
      return { key: def.key, label: def.label, source: src.label, ..._calcStats(values, total) };
    });
  });
}

function resolveReferenceUrl(rawUrl: string): string {
  const trimmedUrl = rawUrl.trim();
  if (trimmedUrl === '') return '';
  if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) return trimmedUrl;
  if (trimmedUrl.startsWith('doi.org/')) return `https://${trimmedUrl}`;
  if (trimmedUrl.startsWith('10.')) return `https://doi.org/${trimmedUrl}`;
  return trimmedUrl;
}

function escapeCsvCell(rawValue: string | number): string {
  const textValue = String(rawValue ?? '');
  const escapedValue = textValue.replaceAll('"', '""');
  return /[",\n]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue;
}

function buildFamilyCsvContent(rows: CadmaReferenceRowView[]): string {
  const headerLine = CSV_EXPORT_KEYS.join(',');
  const dataLines = rows.map((row) =>
    CSV_EXPORT_KEYS.map((key) => escapeCsvCell(row[key] ?? '')).join(','),
  );
  return [headerLine, ...dataLines].join('\n');
}

function sanitizeFamilyFileName(name: string): string {
  const normalizedName = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/(?:^_+)|(?:_+$)/g, '');
  return normalizedName || 'cadma_reference_family';
}

const SCOPE_CONFIG: Record<ScopeKind, { icon: string; label: string; cssClass: string }> = {
  root: { icon: '', label: 'Global (Root)', cssClass: 'scope-root' },
  group: { icon: '', label: 'Group', cssClass: 'scope-group' },
  personal: { icon: '', label: 'Personal', cssClass: 'scope-personal' },
  unknown: { icon: '', label: 'Unknown', cssClass: 'scope-unknown' },
};

@Component({
  selector: 'app-cadma-py-family-detail',
  standalone: true,
  imports: [FormsModule, ScientificChartComponent, TranslocoPipe],
  templateUrl: './cadma-py-family-detail.component.html',
  styleUrl: './cadma-py-family-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyFamilyDetailComponent {
  private readonly cadmaApi = inject(CadmaPyApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly jobsApi = inject(JobsApiService);
  private readonly translocoService = inject(TranslocoService);

  @ViewChild('compoundDetailDialog')
  protected readonly compoundDetailDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('boxplotDialog')
  protected readonly boxplotDialogRef?: ElementRef<HTMLDialogElement>;

  readonly boxplotOpen = signal<boolean>(false);
  readonly visibleBoxplotGroups = signal<Set<string>>(new Set(['ADME', 'Toxicity', 'SA Score']));
  readonly hiddenBoxplotKeys = signal<Set<string>>(new Set());

  readonly allBoxplotMetrics = computed<BoxplotMetricDef[]>(() => getReferenceBoxplotMetricDefs());

  readonly boxplotOptions = computed<EChartsCoreOption>(() => {
    return buildCadmaBoxplotOptions(
      this.library().rows,
      this.visibleBoxplotGroups(),
      this.hiddenBoxplotKeys(),
    );
  });

  readonly boxplotGroups = ['ADME', 'Toxicity', 'SA Score'] as const;

  toggleBoxplotGroup(group: string): void {
    this.visibleBoxplotGroups.update((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        if (next.size > 1) next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  toggleBoxplotMetric(key: string): void {
    this.hiddenBoxplotKeys.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  isGroupVisible(group: string): boolean {
    return this.visibleBoxplotGroups().has(group);
  }

  isMetricHidden(key: string): boolean {
    return this.hiddenBoxplotKeys().has(key);
  }

  visibleMetricsForGroup(group: string): BoxplotMetricDef[] {
    return this.allBoxplotMetrics().filter((m) => m.group === group);
  }

  onBoxplotChartClick(params: Record<string, unknown>): void {
    const seriesType = params['seriesType'] as string | undefined;
    if (seriesType !== 'scatter') return;

    const data = params['data'] as { smiles?: string } | undefined;
    const smiles = data?.smiles;
    if (!smiles) return;

    const rowIndex = this.library().rows.findIndex((r) => r.smiles === smiles);
    if (rowIndex < 0) return;

    const row = this.library().rows[rowIndex];
    this.openCompoundDetail(row, rowIndex, false);
  }

  readonly library = input.required<CadmaReferenceLibraryView>();
  /** Modo del componente: 'browsing' = exploración pre-selección, 'selected' = familia ya elegida. */
  readonly mode = input<'browsing' | 'selected'>('selected');
  readonly autoOpenEditorLibraryId = input<string>('');
  readonly libraryChanged = output<string | undefined>();
  readonly copiedLibraryCreated = output<string>();
  readonly selectAsReference = output<void>();
  readonly closeBrowsing = output<void>();

  /** Edición de metadatos de la familia (nombre, enfermedad, paper, descripción). */
  readonly editingFamily = signal<boolean>(false);
  readonly familyDraft = signal<FamilyMetadataDraft>({
    name: '',
    disease_name: '',
    description: '',
    paper_reference: '',
    paper_url: '',
  });
  readonly familyEditBusy = signal<boolean>(false);
  readonly familyEditError = signal<string>('');
  readonly forkBusy = signal<boolean>(false);
  readonly forkError = signal<string>('');
  readonly showCopyForm = signal<boolean>(false);
  readonly copyDraftName = signal<string>('');

  /** Índice de la fila actualmente en edición; -1 = ninguna. */
  readonly editingRowIndex = signal<number>(-1);
  readonly editDraft = signal<CadmaReferenceRowPatchPayload>({});
  readonly editBusy = signal<boolean>(false);
  readonly deletingRowIndex = signal<number>(-1);
  readonly rowActionError = signal<string>('');

  /** Formulario de agregar compuesto. */
  readonly showAddForm = signal<boolean>(false);
  readonly addSmiles = signal<string>('');
  readonly addName = signal<string>('');
  readonly addAuthors = signal<string>('');
  readonly addPaperRef = signal<string>('');
  readonly addPaperUrl = signal<string>('');
  readonly addNote = signal<string>('');
  readonly addDT = signal<string>('');
  readonly addM = signal<string>('');
  readonly addLD50 = signal<string>('');
  readonly addSA = signal<string>('');
  readonly addBusy = signal<boolean>(false);
  readonly addError = signal<string>('');

  /** Controla visibilidad de tabla de compuestos. */
  readonly showCompoundsTable = signal<boolean>(false);

  /** Modal con el detalle completo de un compuesto específico. */
  readonly selectedCompound = signal<CadmaReferenceRowView | null>(null);
  readonly compoundModalSvg = signal<SafeHtml | null>(null);
  readonly compoundModalBusy = signal<boolean>(false);
  readonly compoundModalError = signal<string>('');
  readonly isEditingCompound = computed<boolean>(() => this.editingRowIndex() >= 0);

  readonly selectedCompoundIndex = computed<number>(() => {
    const compound = this.selectedCompound();
    if (!compound) return -1;
    return this.library().rows.findIndex((r) => r.smiles === compound.smiles);
  });
  readonly hasPrevCompound = computed(() => this.selectedCompoundIndex() > 0);
  readonly hasNextCompound = computed(
    () => this.selectedCompoundIndex() < this.library().rows.length - 1,
  );

  readonly scopeKind = computed<ScopeKind>(() => computeScopeKind(this.library().source_reference));
  readonly scopeConfig = computed(() => SCOPE_CONFIG[this.scopeKind()]);
  readonly canForkFamily = computed<boolean>(() => this.library().forkable === true);

  readonly metricStats = computed<MetricStat[]>(() => computeMetricStats(this.library().rows));
  readonly selectedCompoundAdme = computed<Array<{ key: string; label: string; value: number }>>(
    () => ADME_KEYS.map((key) => ({
      key,
      label: ADME_FULL_LABELS[key],
      value: (this.selectedCompound()?.[key as keyof CadmaReferenceRowView] as number) ?? 0,
    })),
  );

  readonly selectedCompoundToxicity = computed(() => {
    const compound = this.selectedCompound();
    if (!compound) return [];
    return TOXICITY_METRICS.map((metric) => ({
      key: metric.key,
      label: metric.label,
      values: metric.software.map((swKey, i) => ({
        source: metric.suffixes[i],
        value: compound[swKey as keyof CadmaReferenceRowView] as number | null | undefined,
      })),
    }));
  });

  readonly selectedCompoundSA = computed(() => {
    const compound = this.selectedCompound();
    if (!compound) return null;
    return {
      key: SA_METRIC.key,
      label: SA_METRIC.label,
      values: SA_METRIC.software.map((swKey, i) => ({
        source: SA_METRIC.suffixes[i],
        value: compound[swKey as keyof CadmaReferenceRowView] as number | null | undefined,
      })),
    };
  });

  readonly hasAnyNulls = computed<boolean>(() =>
    this.metricStats().some((stat) => stat.nullCount > 0),
  );

  readonly paperUrl = computed<string>(() => resolveReferenceUrl(this.library().paper_url));
  readonly selectedCompoundPaperUrl = computed<string>(() =>
    resolveReferenceUrl(this.selectedCompound()?.paper_url ?? ''),
  );

  private readonly autoOpenedLibraryId = signal<string>('');

  constructor() {
    effect(() => {
      const requestedLibraryId = this.autoOpenEditorLibraryId();
      const currentLibraryId = this.library().id;
      if (
        requestedLibraryId === '' ||
        requestedLibraryId !== currentLibraryId ||
        this.autoOpenedLibraryId() === requestedLibraryId ||
        !this.library().editable
      ) {
        return;
      }

      this.startFamilyEdit();
      this.autoOpenedLibraryId.set(requestedLibraryId);
    });
  }
  readonly selectionActionLabel = computed<string>(() => this.translocoService.translate('cadmaPy.familyDetail.selectFamily'));
  readonly copyActionLabel = computed<string>(() => this.translocoService.translate('cadmaPy.familyDetail.copyFamily'));
  readonly readOnlyGuidance = computed<string>(() => {
    if (this.scopeKind() === 'root') {
      return this.translocoService.translate('cadmaPy.familyDetail.rootReadOnly');
    }
    if (this.scopeKind() === 'group') {
      return this.translocoService.translate('cadmaPy.familyDetail.groupReadOnly');
    }
    return this.translocoService.translate('cadmaPy.familyDetail.defaultReadOnly');
  });

  readonly createdDate = computed<string>(() => {
    const isoDate = this.library().created_at;
    if (!isoDate) return '—';
    try {
      return new Date(isoDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoDate;
    }
  });

  readonly editableLabel = computed<string>(() => {
    const lib = this.library();
    if (lib.editable && lib.deletable) return this.translocoService.translate('cadmaPy.familyDetail.fullAccess');
    if (lib.editable) return this.translocoService.translate('cadmaPy.familyDetail.canEdit');
    if (lib.forkable) return this.translocoService.translate('cadmaPy.familyDetail.readOnlyTemplate');
    return this.translocoService.translate('cadmaPy.familyDetail.readOnly');
  });

  private readonly INT_KEYS = new Set(['HBLA', 'HBLD', 'AtX', 'RB']);

  trackStat(index: number, stat: MetricStat): string {
    return `${stat.key}_${stat.source ?? '_'}_${index}`;
  }

  formatNumber(value: number, decimals: number = 2): string {
    return value.toFixed(decimals);
  }

  formatMetricValue(key: string, value: number): string {
    return this.INT_KEYS.has(key) ? value.toFixed(0) : value.toFixed(2);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  exportFamilyCsv(): void {
    const rows = this.library().rows;
    if (rows.length === 0) {
      return;
    }

    downloadBlobFile(
      `${sanitizeFamilyFileName(this.library().name)}_family.csv`,
      new Blob([buildFamilyCsvContent(rows)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
  }

  toggleCompoundsTable(): void {
    this.showCompoundsTable.update((current) => !current);
  }

  rowPaperUrl(row: CadmaReferenceRowView): string {
    return resolveReferenceUrl(row.paper_url);
  }

  openCompoundDetail(
    row: CadmaReferenceRowView,
    rowIndex: number = -1,
    editMode: boolean = false,
  ): void {
    if (row.smiles.trim() === '') {
      return;
    }

    this.selectedCompound.set(row);
    this.rowActionError.set('');
    this.compoundModalSvg.set(null);
    this.compoundModalError.set('');
    this.compoundModalBusy.set(true);
    this.editingRowIndex.set(editMode ? rowIndex : -1);
    if (editMode) {
      this.editDraft.set({
        name: row.name,
        paper_reference: row.paper_reference,
        paper_url: row.paper_url,
        evidence_note: row.evidence_note,
      });
    } else {
      this.editDraft.set({});
    }
    this.compoundDetailDialogRef?.nativeElement.showModal();

    this.jobsApi.inspectSmileitStructure(row.smiles).subscribe({
      next: (inspection) => {
        this.compoundModalSvg.set(this.sanitizer.bypassSecurityTrustHtml(inspection.svg)); // NOSONAR: S6268 - SVG from internal backend, never user input
        this.compoundModalBusy.set(false);
      },
      error: () => {
        this.compoundModalError.set('Could not generate the molecule preview.');
        this.compoundModalBusy.set(false);
      },
    });
  }

  closeCompoundDetail(): void {
    this.compoundDetailDialogRef?.nativeElement.close();
    this.selectedCompound.set(null);
    this.compoundModalSvg.set(null);
    this.compoundModalError.set('');
    this.compoundModalBusy.set(false);
    this.editingRowIndex.set(-1);
    this.editDraft.set({});
    this.rowActionError.set('');
  }

  navigateCompound(direction: 1 | -1): void {
    const currentIdx = this.selectedCompoundIndex();
    if (currentIdx < 0) return;
    const nextIdx = currentIdx + direction;
    const rows = this.library().rows;
    if (nextIdx < 0 || nextIdx >= rows.length) return;
    const nextCompound = rows[nextIdx];

    this.selectedCompound.set(nextCompound);
    this.rowActionError.set('');
    this.compoundModalSvg.set(null);
    this.compoundModalError.set('');
    this.compoundModalBusy.set(true);
    this.editingRowIndex.set(-1);
    this.editDraft.set({});

    this.jobsApi.inspectSmileitStructure(nextCompound.smiles).subscribe({
      next: (inspection) => {
        this.compoundModalSvg.set(this.sanitizer.bypassSecurityTrustHtml(inspection.svg));
        this.compoundModalBusy.set(false);
      },
      error: () => {
        this.compoundModalError.set('Could not generate the molecule preview.');
        this.compoundModalBusy.set(false);
      },
    });
  }

  onCompoundDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.compoundDetailDialogRef?.nativeElement, () => {
      this.closeCompoundDetail();
    });
  }

  openBoxplot(): void {
    this.boxplotOpen.set(true);
    this.boxplotDialogRef?.nativeElement.showModal();
  }

  closeBoxplot(): void {
    this.boxplotDialogRef?.nativeElement.close();
    this.boxplotOpen.set(false);
  }

  onBoxplotBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.boxplotDialogRef?.nativeElement, () => {
      this.closeBoxplot();
    });
  }

  /** Abre el modo edición de metadatos de la familia. */
  startFamilyEdit(): void {
    const lib = this.library();
    this.familyDraft.set({
      name: lib.name,
      disease_name: lib.disease_name,
      description: lib.description,
      paper_reference: lib.paper_reference,
      paper_url: lib.paper_url,
    });
    this.familyEditError.set('');
    this.forkError.set('');
    this.editingFamily.set(true);
  }

  forkFamily(): void {
    this.copyDraftName.set(`${this.library().name} Copy`);
    this.forkError.set('');
    this.showCopyForm.set(true);
  }

  cancelForkFamily(): void {
    this.showCopyForm.set(false);
    this.forkError.set('');
  }

  confirmForkFamily(): void {
    const trimmedName = this.copyDraftName().trim();
    if (trimmedName === '') {
      this.forkError.set('The new copied family needs a name.');
      return;
    }

    this.forkBusy.set(true);
    this.forkError.set('');

    const libraryId = this.library().id;
    const request$ = libraryId.startsWith('sample-')
      ? this.cadmaApi.importReferenceSample(libraryId.replace('sample-', ''), trimmedName)
      : this.cadmaApi.forkReferenceLibrary(libraryId, trimmedName);

    request$.subscribe({
      next: (forkedLibrary) => {
        this.forkBusy.set(false);
        this.showCopyForm.set(false);
        this.copiedLibraryCreated.emit(forkedLibrary.id);
        if (libraryId.startsWith('sample-')) {
          this.closeBrowsing.emit();
        }
      },
      error: (err: Error) => {
        this.forkBusy.set(false);
        this.forkError.set(err.message || 'Failed to copy the family.');
      },
    });
  }

  cancelFamilyEdit(): void {
    this.editingFamily.set(false);
    this.familyEditError.set('');
  }

  saveFamilyEdit(): void {
    const draft = this.familyDraft();
    if (!draft.name.trim() || !draft.disease_name.trim()) {
      this.familyEditError.set('Name and disease are required.');
      return;
    }
    this.familyEditBusy.set(true);
    this.familyEditError.set('');
    const payload: Partial<CadmaReferenceLibraryWritePayload> = {
      name: draft.name.trim(),
      disease_name: draft.disease_name.trim(),
      description: draft.description.trim(),
      paper_reference: draft.paper_reference.trim(),
      paper_url: draft.paper_url.trim(),
    };
    this.cadmaApi.updateReferenceLibrary(this.library().id, payload).subscribe({
      next: (updatedLibrary) => {
        this.familyEditBusy.set(false);
        this.editingFamily.set(false);
        this.libraryChanged.emit(updatedLibrary.id);
      },
      error: (err: Error) => {
        this.familyEditBusy.set(false);
        this.familyEditError.set(err.message || 'Failed to update family.');
      },
    });
  }

  /** Abre el modal del compuesto directamente en modo edición. */
  startEditRow(index: number, row: CadmaReferenceRowView): void {
    this.openCompoundDetail(row, index, true);
  }

  cancelEdit(): void {
    this.editingRowIndex.set(-1);
    this.editDraft.set({});
    this.rowActionError.set('');
  }

  startEditCurrentCompound(): void {
    const compound = this.selectedCompound();
    if (compound === null) {
      return;
    }

    const rowIndex = this.library().rows.findIndex((row) => row.smiles === compound.smiles);
    this.startEditRow(rowIndex, compound);
  }

  saveRowEdit(): void {
    const index = this.editingRowIndex();
    if (index < 0) return;
    this.editBusy.set(true);
    this.rowActionError.set('');
    this.cadmaApi.patchReferenceRow(this.library().id, index, this.editDraft()).subscribe({
      next: () => {
        this.editBusy.set(false);
        this.editingRowIndex.set(-1);
        this.closeCompoundDetail();
        this.libraryChanged.emit(this.library().id);
      },
      error: (err: Error) => {
        this.editBusy.set(false);
        this.rowActionError.set(err.message || 'Failed to update the compound reference.');
      },
    });
  }

  removeRow(index: number): void {
    const confirmed =
      typeof globalThis.confirm !== 'function' ||
      globalThis.confirm('Remove this compound from the reference family?');
    if (!confirmed) {
      return;
    }

    this.deletingRowIndex.set(index);
    this.rowActionError.set('');
    this.cadmaApi.deleteReferenceRow(this.library().id, index).subscribe({
      next: () => {
        this.deletingRowIndex.set(-1);
        this.libraryChanged.emit(this.library().id);
      },
      error: (err: Error) => {
        this.deletingRowIndex.set(-1);
        this.rowActionError.set(err.message || 'Failed to remove the compound.');
      },
    });
  }

  duplicateRow(index: number): void {
    const row = this.library().rows[index];
    if (!row) return;
    const payload: CadmaCompoundAddPayload = {
      smiles: row.smiles,
      name: row.name,
      paper_authors: row.paper_authors,
      paper_reference: row.paper_reference,
      paper_url: row.paper_url,
      evidence_note: row.evidence_note,
      toxicity_dt: row.DT ?? null,
      toxicity_m: row.M ?? null,
      toxicity_ld50: row.LD50 ?? null,
      sa_score: row.SA ?? null,
    };
    this.addBusy.set(true);
    this.rowActionError.set('');
    this.cadmaApi.addCompoundToLibrary(this.library().id, payload).subscribe({
      next: () => {
        this.addBusy.set(false);
        this.libraryChanged.emit(this.library().id);
      },
      error: (err: Error) => {
        this.addBusy.set(false);
        this.rowActionError.set(err.message || 'Failed to duplicate compound.');
      },
    });
  }

  /** Abre/cierra el formulario de agregar compuesto. */
  toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    this.addError.set('');
  }

  submitAddCompound(): void {
    const smiles = this.addSmiles().trim();
    if (!smiles) {
      this.addError.set('SMILES is required.');
      return;
    }
    this.addBusy.set(true);
    this.addError.set('');
    const parseNum = (v: string): number | null => {
      const trimmed = v.trim();
      return trimmed === '' ? null : Number(trimmed);
    };
    const payload: CadmaCompoundAddPayload = {
      smiles,
      name: this.addName().trim(),
      paper_authors: this.addAuthors().trim(),
      paper_reference: this.addPaperRef().trim(),
      paper_url: this.addPaperUrl().trim(),
      evidence_note: this.addNote().trim(),
      toxicity_dt: parseNum(this.addDT()),
      toxicity_m: parseNum(this.addM()),
      toxicity_ld50: parseNum(this.addLD50()),
      sa_score: parseNum(this.addSA()),
    };
    this.cadmaApi.addCompoundToLibrary(this.library().id, payload).subscribe({
      next: () => {
        this.addBusy.set(false);
        this.addSmiles.set('');
        this.addName.set('');
        this.addAuthors.set('');
        this.addPaperRef.set('');
        this.addPaperUrl.set('');
        this.addNote.set('');
        this.addDT.set('');
        this.addM.set('');
        this.addLD50.set('');
        this.addSA.set('');
        this.showAddForm.set(false);
        this.libraryChanged.emit(this.library().id);
      },
      error: (err: Error) => {
        this.addBusy.set(false);
        this.addError.set(err.message || 'Failed to add compound.');
      },
    });
  }
}

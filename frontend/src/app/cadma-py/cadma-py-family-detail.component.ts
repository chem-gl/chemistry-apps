// cadma-py-family-detail.component.ts: Detalle expandible de una familia de referencia CADMA Py.
// Muestra promedios por métrica, trazabilidad, scope de permisos, tabla de compuestos
// con edición inline de referencias documentales y formulario para agregar compuestos.

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
import { TranslocoPipe } from '@jsverse/transloco';
import {
  CadmaCompoundAddPayload,
  CadmaPyApiService,
  CadmaReferenceLibraryView,
  CadmaReferenceLibraryWritePayload,
  CadmaReferenceRowPatchPayload,
  CadmaReferenceRowView,
} from '../core/api/cadma-py-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import {
  closeDialogOnBackdropClick,
  downloadBlobFile,
} from '../core/shared/scientific-app-ui.utils';

const METRIC_LABELS: Record<string, string> = {
  MW: 'Molecular Weight',
  logP: 'LogP',
  MR: 'Molar Refractivity',
  AtX: 'Heavy Atoms',
  HBLA: 'HB Acceptors',
  HBLD: 'HB Donors',
  RB: 'Rotatable Bonds',
  PSA: 'Polar SA',
  DT: 'Dev. Toxicity',
  M: 'Mutagenicity',
  LD50: 'LD50 (mg/kg)',
  SA: 'SA Score',
};

const METRIC_KEYS = Object.keys(METRIC_LABELS);
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
  mean: number;
  stdev: number;
  min: number;
  max: number;
  nullCount: number;
  total: number;
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

function computeMetricStats(rows: CadmaReferenceRowView[]): MetricStat[] {
  return METRIC_KEYS.map((key) => {
    const values = rows
      .map((row) => row[key as keyof CadmaReferenceRowView] as number | null)
      .filter(
        (value): value is number => value !== null && value !== undefined && !Number.isNaN(value),
      );

    const nullCount = rows.length - values.length;
    const total = rows.length;

    if (values.length === 0) {
      return {
        key,
        label: METRIC_LABELS[key],
        mean: 0,
        stdev: 0,
        min: 0,
        max: 0,
        nullCount,
        total,
      };
    }

    const sum = values.reduce((acc, val) => acc + val, 0);
    const mean = sum / values.length;
    const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);

    return {
      key,
      label: METRIC_LABELS[key],
      mean,
      stdev,
      min: Math.min(...values),
      max: Math.max(...values),
      nullCount,
      total,
    };
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
  root: { icon: '🌐', label: 'Global (Root)', cssClass: 'scope-root' },
  group: { icon: '👥', label: 'Group', cssClass: 'scope-group' },
  personal: { icon: '👤', label: 'Personal', cssClass: 'scope-personal' },
  unknown: { icon: '❓', label: 'Unknown', cssClass: 'scope-unknown' },
};

@Component({
  selector: 'app-cadma-py-family-detail',
  standalone: true,
  imports: [FormsModule, TranslocoPipe],
  templateUrl: './cadma-py-family-detail.component.html',
  styleUrl: './cadma-py-family-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyFamilyDetailComponent {
  private readonly cadmaApi = inject(CadmaPyApiService);
  private readonly jobsApi = inject(JobsApiService);

  @ViewChild('compoundDetailDialog')
  protected readonly compoundDetailDialogRef?: ElementRef<HTMLDialogElement>;

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
  readonly addPaperRef = signal<string>('');
  readonly addPaperUrl = signal<string>('');
  readonly addNote = signal<string>('');
  readonly addBusy = signal<boolean>(false);
  readonly addError = signal<string>('');

  /** Controla visibilidad de tabla de compuestos. */
  readonly showCompoundsTable = signal<boolean>(false);

  /** Modal con el detalle completo de un compuesto específico. */
  readonly selectedCompound = signal<CadmaReferenceRowView | null>(null);
  readonly compoundModalSvg = signal<string | null>(null);
  readonly compoundModalBusy = signal<boolean>(false);
  readonly compoundModalError = signal<string>('');
  readonly isEditingCompound = computed<boolean>(() => this.editingRowIndex() >= 0);

  readonly scopeKind = computed<ScopeKind>(() => computeScopeKind(this.library().source_reference));
  readonly scopeConfig = computed(() => SCOPE_CONFIG[this.scopeKind()]);
  readonly canForkFamily = computed<boolean>(() => this.library().forkable === true);

  readonly metricStats = computed<MetricStat[]>(() => computeMetricStats(this.library().rows));
  readonly selectedCompoundMetrics = computed<Array<{ key: string; label: string; value: number }>>(
    () => {
      const compound = this.selectedCompound();
      if (compound === null) {
        return [];
      }
      return METRIC_KEYS.map((key) => ({
        key,
        label: METRIC_LABELS[key],
        value: compound[key as keyof CadmaReferenceRowView] as number,
      }));
    },
  );

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
  readonly selectionActionLabel = computed<string>(() => 'Select family →');
  readonly copyActionLabel = computed<string>(() => '⎘ Copy family');
  readonly readOnlyGuidance = computed<string>(() => {
    if (this.scopeKind() === 'root') {
      return 'This root family is read-only for you. Create an editable copy to add, remove or update compounds and references.';
    }
    if (this.scopeKind() === 'group') {
      return 'This shared group family is read-only for you. Create an editable copy to add, remove or update compounds and references.';
    }
    return 'This family is read-only in your current scope. Create an editable copy to modify it safely.';
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
    if (lib.editable && lib.deletable) return 'Full access';
    if (lib.editable) return 'Can edit';
    if (lib.forkable) return 'Read-only template';
    return 'Read only';
  });

  formatNumber(value: number, decimals: number = 2): string {
    return value.toFixed(decimals);
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
        this.compoundModalSvg.set(inspection.svg);
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

  onCompoundDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.compoundDetailDialogRef?.nativeElement, () => {
      this.closeCompoundDetail();
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
    const payload: CadmaCompoundAddPayload = {
      smiles,
      name: this.addName().trim(),
      paper_reference: this.addPaperRef().trim(),
      paper_url: this.addPaperUrl().trim(),
      evidence_note: this.addNote().trim(),
    };
    this.cadmaApi.addCompoundToLibrary(this.library().id, payload).subscribe({
      next: () => {
        this.addBusy.set(false);
        this.addSmiles.set('');
        this.addName.set('');
        this.addPaperRef.set('');
        this.addPaperUrl.set('');
        this.addNote.set('');
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

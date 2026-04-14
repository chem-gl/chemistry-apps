// sa-score.component.ts: Pantalla principal de SA Score con entrada de SMILES, sketch molecular,
// carga de archivos, visualización de imagen de molécula y exportes CSV.

import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { SaScoreMethod, SaScoreMoleculeResultView } from '../core/api/jobs-api.service';
import { SaScoreWorkflowService } from '../core/application/sa-score-workflow.service';
import { JobHistoryTableComponent } from '../core/shared/components/job-history-table/job-history-table.component';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { SmilesBatchInputComponent } from '../core/shared/components/smiles-batch-input/smiles-batch-input.component';
import {
  applyResultTableSortDirection,
  compareNullableResultTableNumber,
  compareResultTableText,
  matchesResultTableQuery,
  nextResultTableSortState,
  ResultTableSortState,
} from '../core/shared/result-table.utils';
import { downloadReportFile, NamedSmilesInputRow } from '../core/shared/scientific-app-ui.utils';
import {
  buildScientificJobDisplayName,
  resolveScientificJobNameForHistory,
} from '../core/shared/scientific-job-name.utils';
import { SmilesMoleculesBaseComponent } from '../core/shared/smiles-molecules-base.component';

@Component({
  selector: 'app-sa-score',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    JobLogsPanelComponent,
    JobHistoryTableComponent,
    SmilesBatchInputComponent,
  ],
  providers: [SaScoreWorkflowService],
  templateUrl: './sa-score.component.html',
  styleUrl: './sa-score.component.scss',
})
export class SaScoreComponent extends SmilesMoleculesBaseComponent {
  protected override readonly workflow = inject(SaScoreWorkflowService);
  readonly resolveHistoryJobDisplayName = (historyJob: {
    id: string;
    parameters: unknown;
  }): string =>
    buildScientificJobDisplayName(
      historyJob.id,
      resolveScientificJobNameForHistory('sa-score', historyJob.id, historyJob.parameters),
    );

  readonly methodItems = [
    { key: 'ambit' as SaScoreMethod, label: 'AMBIT SA' },
    { key: 'brsa' as SaScoreMethod, label: 'BRSAScore SA' },
    { key: 'rdkit' as SaScoreMethod, label: 'RDKit SA' },
  ];
  readonly selectedExportTarget = signal<ExportTarget>('all');
  readonly tableSearchTerm = signal<string>('');
  readonly tableSort = signal<ResultTableSortState<SaScoreSortColumn>>({
    column: 'name',
    direction: 'asc',
  });

  readonly exportOptions = computed<ReadonlyArray<ExportOption>>(() => {
    const currentResultData = this.workflow.resultData();
    if (currentResultData === null) {
      return [];
    }

    const methodOptions: ExportOption[] = this.methodItems
      .filter((methodItem) => currentResultData.requestedMethods.includes(methodItem.key))
      .map((methodItem) => ({
        value: methodItem.key,
        label: `${methodItem.label} CSV`,
      }));

    return [{ value: 'all', label: 'All methods CSV' }, ...methodOptions];
  });

  readonly visibleMolecules = computed<SaScoreMoleculeResultView[]>(() => {
    const currentResultData = this.workflow.resultData();
    if (currentResultData === null) {
      return [];
    }

    const filteredRows: SaScoreMoleculeResultView[] = currentResultData.molecules.filter(
      (molecule: SaScoreMoleculeResultView) =>
        matchesResultTableQuery([molecule.name, molecule.smiles], this.tableSearchTerm()),
    );

    const sortState: ResultTableSortState<SaScoreSortColumn> = this.tableSort();
    return [...filteredRows].sort((leftRow, rightRow) =>
      applyResultTableSortDirection(
        this.compareMolecules(leftRow, rightRow, sortState.column),
        sortState.direction,
      ),
    );
  });

  readonly filteredMoleculeCount = computed<number>(() => this.visibleMolecules().length);

  constructor() {
    super();
    effect(() => {
      const availableOptions = this.exportOptions();
      if (availableOptions.length === 0) {
        return;
      }
      const selectedTarget = this.selectedExportTarget();
      const hasSelectedTarget = availableOptions.some((option) => option.value === selectedTarget);
      if (!hasSelectedTarget) {
        this.selectedExportTarget.set('all');
      }
    });
  }

  protected override get workflowSmilesInput(): WritableSignal<string> {
    return this.workflow.smilesInput;
  }

  protected override get workflowInputRows(): WritableSignal<NamedSmilesInputRow[]> {
    return this.workflow.inputRows;
  }

  protected override get workflowCustomNamesEnabled(): WritableSignal<boolean> {
    return this.workflow.customNamesEnabled;
  }

  exportAllCsv(): void {
    downloadReportFile(this.workflow.downloadFullCsvReport());
  }

  exportMethodCsv(method: SaScoreMethod): void {
    downloadReportFile(this.workflow.downloadMethodCsvReport(method));
  }

  exportCsv(): void {
    const exportTarget: ExportTarget = this.selectedExportTarget();
    if (exportTarget === 'all') {
      this.exportAllCsv();
      return;
    }
    this.exportMethodCsv(exportTarget);
  }

  updateTableSearch(nextValue: string): void {
    this.tableSearchTerm.set(nextValue);
  }

  toggleTableSort(column: SaScoreSortColumn): void {
    this.tableSort.update((currentState) => nextResultTableSortState(currentState, column));
  }

  sortIndicator(column: SaScoreSortColumn): string {
    const currentSortState = this.tableSort();
    if (currentSortState.column !== column) {
      return '↕';
    }
    return currentSortState.direction === 'asc' ? '↑' : '↓';
  }

  ariaSort(column: SaScoreSortColumn): 'ascending' | 'descending' | 'none' {
    const currentSortState = this.tableSort();
    if (currentSortState.column !== column) {
      return 'none';
    }
    return currentSortState.direction === 'asc' ? 'ascending' : 'descending';
  }

  currentJobDisplayLabel(): string | null {
    const currentJobId: string | null = this.workflow.currentJobId();
    if (currentJobId === null) {
      return null;
    }

    const currentJobName: string | null = this.workflow.currentJobDisplayName();
    if (currentJobName === null) {
      return null;
    }

    return buildScientificJobDisplayName(currentJobId, currentJobName);
  }

  resultTableColspan(requestedMethods: SaScoreMethod[]): number {
    return requestedMethods.length + 2;
  }

  hasMethodError(molecule: SaScoreMoleculeResultView): boolean {
    return this.methodItems.some(
      (methodItem) => this.methodError(molecule, methodItem.key) !== null,
    );
  }

  methodScore(molecule: SaScoreMoleculeResultView, method: SaScoreMethod): string {
    const rawValue: number | null = this.methodScoreValue(molecule, method);

    if (rawValue === null) {
      return '-';
    }

    return rawValue.toFixed(4);
  }

  methodError(molecule: SaScoreMoleculeResultView, method: SaScoreMethod): string | null {
    if (method === 'ambit') return molecule.ambit_error;
    if (method === 'brsa') return molecule.brsa_error;
    return molecule.rdkit_error;
  }

  private methodScoreValue(
    molecule: SaScoreMoleculeResultView,
    method: SaScoreMethod,
  ): number | null {
    if (method === 'ambit') {
      return molecule.ambit_sa;
    }
    if (method === 'brsa') {
      return molecule.brsa_sa;
    }
    return molecule.rdkit_sa;
  }

  private compareMolecules(
    leftRow: SaScoreMoleculeResultView,
    rightRow: SaScoreMoleculeResultView,
    column: SaScoreSortColumn,
  ): number {
    if (column === 'name') {
      return compareResultTableText(leftRow.name, rightRow.name);
    }
    if (column === 'smiles') {
      return compareResultTableText(leftRow.smiles, rightRow.smiles);
    }
    return compareNullableResultTableNumber(
      this.methodScoreValue(leftRow, column),
      this.methodScoreValue(rightRow, column),
    );
  }
}

type ExportTarget = 'all' | SaScoreMethod;
type SaScoreSortColumn = 'name' | 'smiles' | SaScoreMethod;

type ExportOption = {
  value: ExportTarget;
  label: string;
};

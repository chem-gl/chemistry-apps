// toxicity-properties.component.ts: Pantalla principal de Toxicity Properties con
// entrada de SMILES, sketch molecular, carga de archivos, tabla fija y export CSV.

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToxicityMoleculeResultView } from '../core/api/jobs-api.service';
import { ToxicityPropertiesWorkflowService } from '../core/application/toxicity-properties-workflow.service';
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
  selector: 'app-toxicity-properties',
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
  providers: [ToxicityPropertiesWorkflowService],
  templateUrl: './toxicity-properties.component.html',
  styleUrl: './toxicity-properties.component.scss',
})
export class ToxicityPropertiesComponent extends SmilesMoleculesBaseComponent {
  protected override readonly workflow = inject(ToxicityPropertiesWorkflowService);
  readonly resolveHistoryJobDisplayName = (historyJob: {
    id: string;
    parameters: unknown;
  }): string =>
    buildScientificJobDisplayName(
      historyJob.id,
      resolveScientificJobNameForHistory(
        'toxicity-properties',
        historyJob.id,
        historyJob.parameters,
      ),
    );
  readonly tableSearchTerm = signal<string>('');
  readonly tableSort = signal<ResultTableSortState<ToxicitySortColumn>>({
    column: 'name',
    direction: 'asc',
  });

  readonly visibleMolecules = computed<ToxicityMoleculeResultView[]>(() => {
    const currentResultData = this.workflow.resultData();
    if (currentResultData === null) {
      return [];
    }

    const filteredRows: ToxicityMoleculeResultView[] = currentResultData.molecules.filter(
      (molecule: ToxicityMoleculeResultView) =>
        matchesResultTableQuery([molecule.name, molecule.smiles], this.tableSearchTerm()),
    );

    const currentSort = this.tableSort();
    return [...filteredRows].sort((leftRow, rightRow) =>
      applyResultTableSortDirection(
        this.compareMolecules(leftRow, rightRow, currentSort.column),
        currentSort.direction,
      ),
    );
  });

  readonly filteredMoleculeCount = computed<number>(() => this.visibleMolecules().length);

  protected override get workflowSmilesInput(): WritableSignal<string> {
    return this.workflow.smilesInput;
  }

  protected override get workflowInputRows(): WritableSignal<NamedSmilesInputRow[]> {
    return this.workflow.inputRows;
  }

  protected override get workflowCustomNamesEnabled(): WritableSignal<boolean> {
    return this.workflow.customNamesEnabled;
  }

  exportCsv(): void {
    downloadReportFile(this.workflow.downloadCsvReport());
  }

  updateTableSearch(nextValue: string): void {
    this.tableSearchTerm.set(nextValue);
  }

  toggleTableSort(column: ToxicitySortColumn): void {
    this.tableSort.update((currentSort) => nextResultTableSortState(currentSort, column));
  }

  sortIndicator(column: ToxicitySortColumn): string {
    const currentSort = this.tableSort();
    if (currentSort.column !== column) {
      return '↕';
    }
    return currentSort.direction === 'asc' ? '↑' : '↓';
  }

  ariaSort(column: ToxicitySortColumn): 'ascending' | 'descending' | 'none' {
    const currentSort = this.tableSort();
    if (currentSort.column !== column) {
      return 'none';
    }
    return currentSort.direction === 'asc' ? 'ascending' : 'descending';
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

  resultTableColspan(): number {
    return 7;
  }

  formatDecimal(value: number | null, digits: number = 4): string {
    if (value === null) {
      return '-';
    }
    return value.toFixed(digits);
  }

  rowHasError(molecule: ToxicityMoleculeResultView): boolean {
    return molecule.error_message !== null && molecule.error_message.trim() !== '';
  }

  classificationBadgeClass(value: string | null): string {
    const normalizedValue: string = (value ?? '').trim().toLowerCase();
    if (normalizedValue === '') {
      return 'classification-badge classification-badge-neutral';
    }
    if (['negative', 'low', 'safe', 'none'].includes(normalizedValue)) {
      return 'classification-badge classification-badge-positive';
    }
    if (['positive', 'high', 'toxic'].includes(normalizedValue)) {
      return 'classification-badge classification-badge-negative';
    }
    if (['moderate', 'medium', 'warning'].includes(normalizedValue)) {
      return 'classification-badge classification-badge-warning';
    }
    return 'classification-badge classification-badge-neutral';
  }

  private compareMolecules(
    leftRow: ToxicityMoleculeResultView,
    rightRow: ToxicityMoleculeResultView,
    column: ToxicitySortColumn,
  ): number {
    if (column === 'name') {
      return compareResultTableText(leftRow.name, rightRow.name);
    }
    if (column === 'smiles') {
      return compareResultTableText(leftRow.smiles, rightRow.smiles);
    }
    if (column === 'LD50_mgkg' || column === 'ames_score' || column === 'devtox_score') {
      return compareNullableResultTableNumber(leftRow[column], rightRow[column]);
    }
    return compareResultTableText(leftRow[column] ?? '', rightRow[column] ?? '');
  }
}

type ToxicitySortColumn =
  | 'name'
  | 'smiles'
  | 'LD50_mgkg'
  | 'mutagenicity'
  | 'ames_score'
  | 'DevTox'
  | 'devtox_score';

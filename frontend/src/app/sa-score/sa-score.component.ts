// sa-score.component.ts: Pantalla principal de SA Score con entrada de SMILES, sketch molecular,
// carga de archivos, visualización de imagen de molécula y exportes CSV.

import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SaScoreMethod, SaScoreMoleculeResultView } from '../core/api/jobs-api.service';
import { SaScoreWorkflowService } from '../core/application/sa-score-workflow.service';
import { JobHistoryTableComponent } from '../core/shared/components/job-history-table/job-history-table.component';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { SmilesBatchInputComponent } from '../core/shared/components/smiles-batch-input/smiles-batch-input.component';
import { downloadReportFile, NamedSmilesInputRow } from '../core/shared/scientific-app-ui.utils';
import { SmilesMoleculesBaseComponent } from '../core/shared/smiles-molecules-base.component';

@Component({
  selector: 'app-sa-score',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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

  readonly methodItems = [
    { key: 'ambit' as SaScoreMethod, label: 'AMBIT SA' },
    { key: 'brsa' as SaScoreMethod, label: 'BRSAScore SA' },
    { key: 'rdkit' as SaScoreMethod, label: 'RDKit SA' },
  ];
  readonly selectedExportTarget = signal<ExportTarget>('all');

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

  methodScore(molecule: SaScoreMoleculeResultView, method: SaScoreMethod): string {
    let rawValue: number | null;
    if (method === 'ambit') {
      rawValue = molecule.ambit_sa;
    } else if (method === 'brsa') {
      rawValue = molecule.brsa_sa;
    } else {
      rawValue = molecule.rdkit_sa;
    }

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
}

type ExportTarget = 'all' | SaScoreMethod;

type ExportOption = {
  value: ExportTarget;
  label: string;
};

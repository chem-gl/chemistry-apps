// toxicity-properties.component.ts: Pantalla principal de Toxicity Properties con
// entrada de SMILES, sketch molecular, carga de archivos, tabla fija y export CSV.

import { CommonModule } from '@angular/common';
import { Component, inject, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DownloadedReportFile, ToxicityMoleculeResultView } from '../core/api/jobs-api.service';
import { ToxicityPropertiesWorkflowService } from '../core/application/toxicity-properties-workflow.service';
import { JobHistoryTableComponent } from '../core/shared/components/job-history-table/job-history-table.component';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { SmilesBatchInputComponent } from '../core/shared/components/smiles-batch-input/smiles-batch-input.component';
import {
  downloadBlobFile,
  HistoricalJobWorkflowPort,
} from '../core/shared/scientific-app-ui.utils';
import { SmilesMoleculesBaseComponent } from '../core/shared/smiles-molecules-base.component';

@Component({
  selector: 'app-toxicity-properties',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
  readonly workflow = inject(ToxicityPropertiesWorkflowService);

  protected override get workflowSmilesInput(): WritableSignal<string> {
    return this.workflow.smilesInput;
  }

  protected override get workflowPort(): HistoricalJobWorkflowPort {
    return this.workflow;
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        downloadBlobFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {},
    });
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
}


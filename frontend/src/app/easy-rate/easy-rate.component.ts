// easy-rate.component.ts: Pantalla principal de la app Easy-rate para cálculo de constantes de velocidad.
// Gestiona la carga de archivos Gaussian, parámetros cinéticos y visualización de resultados.

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateInspectionExecutionView,
} from '../core/api/jobs-api.service';
import { EasyRateWorkflowService } from '../core/application/easy-rate-workflow.service';
import { SOLVENT_OPTIONS } from '../core/application/easy-rate-workflow.types';
import { DiffusionFieldsComponent } from '../core/shared/components/diffusion-fields/diffusion-fields.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { JobResultFooterComponent } from '../core/shared/components/job-result-footer/job-result-footer.component';
import { ScientificFileAppBaseComponent } from '../core/shared/scientific-file-app-base.component';

interface EasyRateInputSlotView {
  fieldName: EasyRateInputFieldName;
  label: string;
  required: boolean;
  note: string | null;
}

@Component({
  selector: 'app-easy-rate',
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    DiffusionFieldsComponent,
    JobResultFooterComponent,
  ],
  providers: [EasyRateWorkflowService],
  templateUrl: './easy-rate.component.html',
  styleUrl: './easy-rate.component.scss',
})
export class EasyRateComponent extends ScientificFileAppBaseComponent {
  override readonly workflow = inject(EasyRateWorkflowService);

  readonly solventOptions: ReadonlyArray<string> = SOLVENT_OPTIONS;
  readonly inputSlots: ReadonlyArray<EasyRateInputSlotView> = [
    {
      fieldName: 'transition_state_file',
      label: 'Transition State',
      required: true,
      note: null,
    },
    {
      fieldName: 'reactant_1_file',
      label: 'Reactant 1',
      required: true,
      note: null,
    },
    {
      fieldName: 'reactant_2_file',
      label: 'Reactant 2',
      required: true,
      note: null,
    },
    {
      fieldName: 'product_1_file',
      label: 'Product 1',
      required: false,
      note: '(at least one product)',
    },
    {
      fieldName: 'product_2_file',
      label: 'Product 2',
      required: false,
      note: '(at least one product)',
    },
  ];

  // ── Manejadores de archivos ──────────────────────────────────────
  onInputFileChange(fieldName: EasyRateInputFieldName, event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateInputFile(fieldName, input.files?.[0] ?? null);
  }

  onExecutionSelectionChange(fieldName: EasyRateInputFieldName, event: Event): void {
    const selectElement: HTMLSelectElement = event.target as HTMLSelectElement;
    const nextValue: string = selectElement.value.trim();
    this.workflow.updateSelectedExecutionIndex(
      fieldName,
      nextValue === '' ? null : Number(nextValue),
    );
  }

  getSelectedFile(fieldName: EasyRateInputFieldName): File | null {
    return this.workflow.getInputFile(fieldName);
  }

  getInspection(fieldName: EasyRateInputFieldName): EasyRateFileInspectionView | null {
    return this.workflow.getInspection(fieldName);
  }

  getSelectedExecution(fieldName: EasyRateInputFieldName): EasyRateInspectionExecutionView | null {
    return this.workflow.getSelectedInspectionExecution(fieldName);
  }

  getSelectedExecutionIndex(fieldName: EasyRateInputFieldName): number | null {
    return this.workflow.getSelectedExecutionIndex(fieldName);
  }

  isInspectionPending(fieldName: EasyRateInputFieldName): boolean {
    return this.workflow.isInspectionPending(fieldName);
  }

  getInspectionError(fieldName: EasyRateInputFieldName): string | null {
    return this.workflow.getInspectionError(fieldName);
  }

  formatNullableNumber(value: number | null, digits: number = 6): string {
    if (value === null) return '--';
    return value.toFixed(digits);
  }

  buildExecutionOptionLabel(execution: EasyRateInspectionExecutionView): string {
    const titleSegment: string =
      execution.jobTitle?.trim() || `Execution ${execution.executionIndex + 1}`;
    return `${titleSegment} · mult ${execution.multiplicity} · neg freq ${execution.negativeFrequencies}`;
  }

  joinMessages(messages: string[]): string {
    return messages.join(' ');
  }

  // ── Manejadores de parámetros ────────────────────────────────────
  onDiffusionChange(event: Event): void {
    const checkbox: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateDiffusion(checkbox.checked);
  }

  onCageEffectsChange(event: Event): void {
    const checkbox: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateCageEffects(checkbox.checked);
  }

  onPrintDataInputChange(event: Event): void {
    const checkbox: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updatePrintDataInput(checkbox.checked);
  }

  // ── Exportaciones ────────────────────────────────────────────────
  canExport(): boolean {
    return this.workflow.currentJobId() !== null && !this.workflow.isExporting();
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (file: DownloadedReportFile) => this.triggerDownload(file.filename, file.blob),
      error: () => {},
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (file: DownloadedReportFile) => this.triggerDownload(file.filename, file.blob),
      error: () => {},
    });
  }

  exportError(): void {
    this.workflow.downloadErrorReport().subscribe({
      next: (file: DownloadedReportFile) => this.triggerDownload(file.filename, file.blob),
      error: () => {},
    });
  }

  exportInputsZip(): void {
    this.workflow.downloadInputsZip().subscribe({
      next: (file: DownloadedReportFile) => this.triggerDownload(file.filename, file.blob),
      error: () => {},
    });
  }

  // ── Formateo de valores ──────────────────────────────────────────
  formatRateConstant(value: number | null): string {
    if (value === null) return '--';
    return value.toExponential(4).toUpperCase();
  }

  formatKcalMol(value: number): string {
    return value.toFixed(4);
  }

  formatBytes(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1_048_576) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / 1_048_576).toFixed(2)} MB`;
  }

  trackInputSlot(_index: number, slot: EasyRateInputSlotView): EasyRateInputFieldName {
    return slot.fieldName;
  }

  private triggerDownload(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

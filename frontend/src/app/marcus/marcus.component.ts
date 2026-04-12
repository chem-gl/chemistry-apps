// marcus.component.ts: Pantalla principal de la app Marcus para cálculo de energías de Marcus y constantes de velocidad.
// Gestiona la carga de los 6 archivos Gaussian requeridos, parámetros de difusión y visualización de resultados.

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { DownloadedReportFile } from '../core/api/jobs-api.service';
import { MarcusWorkflowService } from '../core/application/marcus-workflow.service';
import { DiffusionFieldsComponent } from '../core/shared/components/diffusion-fields/diffusion-fields.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { JobResultFooterComponent } from '../core/shared/components/job-result-footer/job-result-footer.component';
import { downloadBlobFile } from '../core/shared/scientific-app-ui.utils';
import { ScientificFileAppBaseComponent } from '../core/shared/scientific-file-app-base.component';

@Component({
  selector: 'app-marcus',
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    DiffusionFieldsComponent,
    JobResultFooterComponent,
  ],
  providers: [MarcusWorkflowService],
  templateUrl: './marcus.component.html',
  styleUrl: './marcus.component.scss',
})
export class MarcusComponent extends ScientificFileAppBaseComponent {
  override readonly workflow = inject(MarcusWorkflowService);

  // ── Manejadores de los 6 archivos requeridos ─────────────────────
  onReactant1FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateReactant1File(input.files?.[0] ?? null);
  }

  onReactant2FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateReactant2File(input.files?.[0] ?? null);
  }

  onProduct1AdiabaticFileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct1AdiabaticFile(input.files?.[0] ?? null);
  }

  onProduct2AdiabaticFileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct2AdiabaticFile(input.files?.[0] ?? null);
  }

  onProduct1VerticalFileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct1VerticalFile(input.files?.[0] ?? null);
  }

  onProduct2VerticalFileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct2VerticalFile(input.files?.[0] ?? null);
  }

  // ── Manejadores de parámetros ────────────────────────────────────
  onDiffusionChange(event: Event): void {
    const checkbox: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateDiffusion(checkbox.checked);
  }

  // ── Exportaciones ────────────────────────────────────────────────
  canExport(): boolean {
    return this.workflow.currentJobId() !== null && !this.workflow.isExporting();
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (file: DownloadedReportFile) => downloadBlobFile(file.filename, file.blob),
      error: () => {},
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (file: DownloadedReportFile) => downloadBlobFile(file.filename, file.blob),
      error: () => {},
    });
  }

  exportError(): void {
    this.workflow.downloadErrorReport().subscribe({
      next: (file: DownloadedReportFile) => downloadBlobFile(file.filename, file.blob),
      error: () => {},
    });
  }

  exportInputsZip(): void {
    this.workflow.downloadInputsZip().subscribe({
      next: (file: DownloadedReportFile) => downloadBlobFile(file.filename, file.blob),
      error: () => {},
    });
  }

  // ── Formateo de valores ──────────────────────────────────────────
  formatRateConstant(value: number | null): string {
    if (value === null) return '--';
    return value.toExponential(4).toUpperCase();
  }

  formatKcalMol(value: number | null): string {
    if (value === null) return '--';
    return value.toFixed(4);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }

  // ── Utilidades de plantilla ──────────────────────────────────────
}

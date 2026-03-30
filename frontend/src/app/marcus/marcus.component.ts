// marcus.component.ts: Pantalla principal de la app Marcus para cálculo de energías de Marcus y constantes de velocidad.
// Gestiona la carga de los 6 archivos Gaussian requeridos, parámetros de difusión y visualización de resultados.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DownloadedReportFile } from '../core/api/jobs-api.service';
import { MarcusWorkflowService } from '../core/application/marcus-workflow.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';

@Component({
  selector: 'app-marcus',
  imports: [CommonModule, FormsModule, JobProgressCardComponent, JobLogsPanelComponent],
  providers: [MarcusWorkflowService],
  templateUrl: './marcus.component.html',
  styleUrl: './marcus.component.scss',
})
export class MarcusComponent implements OnInit, OnDestroy {
  readonly workflow = inject(MarcusWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  ngOnInit(): void {
    this.workflow.loadHistory();
    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  clearFiles(): void {
    this.workflow.clearFiles();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

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
  historicalStatusClass(status: string): string {
    const normalized: string = status.toLowerCase();
    if (normalized === 'completed') return 'status-completed';
    if (normalized === 'failed') return 'status-failed';
    if (normalized === 'running' || normalized === 'processing') return 'status-running';
    return 'status-pending';
  }

  // ── Descarga de archivos ─────────────────────────────────────────
  private triggerDownload(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

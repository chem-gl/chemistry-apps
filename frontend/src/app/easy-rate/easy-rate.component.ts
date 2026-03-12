// easy-rate.component.ts: Pantalla principal de la app Easy-rate para cálculo de constantes de velocidad.
// Gestiona la carga de archivos Gaussian, parámetros cinéticos y visualización de resultados.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DownloadedReportFile, JobLogEntryView } from '../core/api/jobs-api.service';
import {
  EasyRateWorkflowService,
  SOLVENT_OPTIONS,
} from '../core/application/easy-rate-workflow.service';

@Component({
  selector: 'app-easy-rate',
  imports: [CommonModule, FormsModule],
  providers: [EasyRateWorkflowService],
  templateUrl: './easy-rate.component.html',
  styleUrl: './easy-rate.component.scss',
})
export class EasyRateComponent implements OnInit, OnDestroy {
  readonly workflow = inject(EasyRateWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  readonly solventOptions: ReadonlyArray<string> = SOLVENT_OPTIONS;

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

  // ── Manejadores de archivos ──────────────────────────────────────
  onTransitionStateFileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateTransitionStateFile(input.files?.[0] ?? null);
  }

  onReactant1FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateReactant1File(input.files?.[0] ?? null);
  }

  onReactant2FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateReactant2File(input.files?.[0] ?? null);
  }

  onProduct1FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct1File(input.files?.[0] ?? null);
  }

  onProduct2FileChange(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    this.workflow.updateProduct2File(input.files?.[0] ?? null);
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

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    if (logLevel === 'error') return 'log-level level-error';
    if (logLevel === 'warning') return 'log-level level-warning';
    if (logLevel === 'debug') return 'log-level level-debug';
    return 'log-level level-info';
  }

  historicalStatusClass(jobStatus: string): string {
    if (jobStatus === 'completed') return 'status-completed';
    if (jobStatus === 'failed') return 'status-failed';
    if (jobStatus === 'running') return 'status-running';
    return 'status-pending';
  }

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

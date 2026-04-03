// job-artifact-export-panel.component.ts: Componente reutilizable para el panel de exportación de artefactos de un job.
// Muestra descriptores de archivos persistidos, botones de exportación y mensajes de error.
// Usado por Easy-rate y Marcus para evitar duplicación de HTML en la sección de resultados.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { JobWorkflowSection } from '../../../application/base-job-workflow.service';

/** Vista de un descriptor de archivo de entrada persistido en un job. */
export interface JobFileDescriptorView {
  fieldName: string;
  originalFilename: string;
  sizeBytes: number;
}

@Component({
  selector: 'app-job-artifact-export-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './job-artifact-export-panel.component.html',
  styleUrl: './job-artifact-export-panel.component.scss',
})
export class JobArtifactExportPanelComponent {
  @Input() fileDescriptors: JobFileDescriptorView[] = [];
  @Input() isExporting: boolean = false;
  @Input() exportErrorMessage: string | null = null;
  @Input() activeSection: JobWorkflowSection = 'idle';
  @Input() errorMessage: string | null = null;
  @Input() currentJobId: string | null = null;
  @Input() canExport: boolean = false;

  @Output() exportCsv = new EventEmitter<void>();
  @Output() exportLog = new EventEmitter<void>();
  @Output() exportInputsZip = new EventEmitter<void>();
  @Output() exportError = new EventEmitter<void>();

  /** Formatea bytes a representación legible (B / KB / MB). */
  formatBytes(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1_048_576) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / 1_048_576).toFixed(2)} MB`;
  }
}

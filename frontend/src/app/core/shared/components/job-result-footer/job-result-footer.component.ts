// job-result-footer.component.ts: Componente reutilizable que agrupa el panel de exportación
// de artefactos, los logs de ejecución y la tabla de historial de jobs. Elimina la duplicación
// de estas tres secciones entre EasyRateComponent y MarcusComponent.

import { Component, EventEmitter, Input, Output } from '@angular/core';

import { JobLogEntryView, ScientificJobView } from '../../../api/jobs-api.service';
import { JobWorkflowSection } from '../../../application/base-job-workflow.service';
import {
  JobArtifactExportPanelComponent,
  JobFileDescriptorView,
} from '../job-artifact-export-panel/job-artifact-export-panel.component';
import { JobHistoryTableComponent } from '../job-history-table/job-history-table.component';
import { JobLogsPanelComponent } from '../job-logs-panel/job-logs-panel.component';

/**
 * Puerto de workflow requerido por JobResultFooterComponent.
 * Cualquier BaseJobWorkflowService<TResult> que tenga fileDescriptors en TResult
 * satisface estructuralmente esta interfaz.
 */
export interface JobResultFooterWorkflowPort {
  /** Señal de datos del resultado; debe incluir fileDescriptors. */
  resultData(): { fileDescriptors: JobFileDescriptorView[] } | null;
  isExporting(): boolean;
  exportErrorMessage(): string | null;
  activeSection(): JobWorkflowSection;
  errorMessage(): string | null;
  currentJobId(): string | null;
  jobLogs(): ReadonlyArray<JobLogEntryView>;
  historyJobs(): ScientificJobView[];
  isHistoryLoading(): boolean;
  loadHistory(): void;
}

@Component({
  selector: 'app-job-result-footer',
  standalone: true,
  imports: [JobArtifactExportPanelComponent, JobLogsPanelComponent, JobHistoryTableComponent],
  templateUrl: './job-result-footer.component.html',
  styleUrl: './job-result-footer.component.scss',
})
export class JobResultFooterComponent {
  /** Workflow del componente padre; proporciona señales de estado y datos del job. */
  @Input({ required: true }) workflow!: JobResultFooterWorkflowPort;

  /** Indica si la exportación está habilitada (calculado en el componente padre). */
  @Input() canExport: boolean = false;

  /** Mensaje mostrado cuando no hay jobs históricos. */
  @Input() emptyMessage: string = 'No historical jobs yet.';

  /** Etiqueta aria-label para la sección de historial. */
  @Input() ariaLabel: string = 'Historical jobs';

  @Output() exportCsv = new EventEmitter<void>();
  @Output() exportLog = new EventEmitter<void>();
  @Output() exportInputsZip = new EventEmitter<void>();
  @Output() exportError = new EventEmitter<void>();
  @Output() openJob = new EventEmitter<string>();
}

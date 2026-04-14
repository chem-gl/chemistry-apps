// job-logs-panel.component.ts: Componente reutilizable para visualizar logs de ejecución de jobs.

import { CommonModule } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { JobLogEntryView } from '../../../api/jobs-api.service';

@Component({
  selector: 'app-job-logs-panel',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './job-logs-panel.component.html',
  styleUrl: './job-logs-panel.component.scss',
})
export class JobLogsPanelComponent {
  @Input() title: string = 'Execution logs';
  @Input() logs: ReadonlyArray<JobLogEntryView> = [];

  readonly isExpanded = signal<boolean>(false);

  toggleExpanded(): void {
    this.isExpanded.update((currentValue) => !currentValue);
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }
}

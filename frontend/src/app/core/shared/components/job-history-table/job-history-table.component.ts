// job-history-table.component.ts: Tabla reutilizable de historial de jobs para apps científicas.
// Muestra Job ID, Status, Updated y botón Open; emite eventos reload y openJob al componente padre.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScientificJobView } from '../../../api/jobs-api.service';

@Component({
  selector: 'app-job-history-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './job-history-table.component.html',
  styleUrl: './job-history-table.component.scss',
})
export class JobHistoryTableComponent {
  /** Lista de jobs históricos a mostrar en la tabla. */
  @Input() jobs: ScientificJobView[] = [];

  /** Indica si el historial se está cargando actualmente. */
  @Input() isLoading: boolean = false;

  /** Mensaje que se muestra cuando no hay jobs históricos. */
  @Input() emptyMessage: string = 'No historical jobs yet.';

  /** Título del encabezado del panel de historial. */
  @Input() sectionTitle: string = 'History';

  /** Etiqueta aria para la sección (accesibilidad). */
  @Input() ariaLabel: string = 'Historical jobs';

  /** Emitido al pulsar "Reload history". */
  @Output() reload = new EventEmitter<void>();

  /** Emitido al pulsar "Open" en una fila; lleva el jobId. */
  @Output() openJob = new EventEmitter<string>();

  /** Clase CSS para el badge de estado del job. */
  statusClass(status: string | undefined): string {
    return `history-status history-${status ?? 'unknown'}`;
  }
}

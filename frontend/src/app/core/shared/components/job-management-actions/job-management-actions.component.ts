// job-management-actions.component.ts: Acciones reutilizables para jobs visibles, eliminables o restaurables.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

@Component({
  selector: 'app-job-management-actions',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './job-management-actions.component.html',
  styleUrl: './job-management-actions.component.scss',
})
export class JobManagementActionsComponent {
  /** Controla si se renderiza el enlace al resultado de la app científica. */
  @Input() showOpenResult: boolean = true;

  /** Ruta base para abrir el resultado del job cuando existe una vista compatible. */
  @Input() openResultRoute: string | null = null;

  /** Query params usados por la navegación al resultado del job. */
  @Input() openResultQueryParams: Params = {};

  /** Etiqueta del enlace al resultado. */
  @Input() openResultLabel: string = 'Open result';

  /** Indica si el botón de borrar debe estar disponible. */
  @Input() canDelete: boolean = false;

  /** Indica si el botón de restaurar debe estar disponible. */
  @Input() canRestore: boolean = false;

  /** Deshabilita acciones mientras una petición está en curso. */
  @Input() isBusy: boolean = false;

  /** Etiqueta personalizada para la acción de borrado. */
  @Input() deleteLabel: string = 'Delete';

  /** Etiqueta personalizada para la acción de restauración. */
  @Input() restoreLabel: string = 'Restore';

  /** Modo compacto para filas de dashboard y tablas. */
  @Input() compact: boolean = false;

  @Output() deleteRequested = new EventEmitter<void>();
  @Output() restoreRequested = new EventEmitter<void>();
}

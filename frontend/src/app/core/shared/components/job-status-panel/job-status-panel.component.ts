// job-status-panel.component.ts: Panel de estado compartido de los jobs científicos.
// Extrae el bloque idle/dispatching/progress/error repetido en las apps científicas
// (mismo markup y clases que los templates originales) para no duplicarlo por app.
// El componente es presentacional: no inyecta servicios, solo recibe signals de entrada.

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { JobWorkflowSection } from '../../../application/base-job-workflow.service';
import { JobProgressCardComponent } from '../job-progress-card/job-progress-card.component';

@Component({
  selector: 'app-job-status-panel',
  standalone: true,
  imports: [TranslocoPipe, JobProgressCardComponent],
  templateUrl: './job-status-panel.component.html',
  styleUrl: './job-status-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobStatusPanelComponent {
  /** Sección activa del workflow (idle, dispatching, progress, result, error). */
  readonly activeSection = input.required<JobWorkflowSection>();
  /** Permite ocultar la tarjeta idle (molar-fractions solo la muestra en modo single). */
  readonly showIdleWhen = input<boolean>(true);
  /** Clave i18n del título en negrita de la tarjeta idle. */
  readonly titleKey = input<string | null>(null);
  /** Clave i18n del subtítulo opcional (`<p>`) de la tarjeta idle. */
  readonly subtitleKey = input<string | null>(null);
  /** Clave i18n de la pista de ejecución de la tarjeta idle. */
  readonly runHintKey = input<string | null>(null);
  /** Clave i18n del mensaje de envío; sin clave no se pinta nada en dispatching. */
  readonly submittingKey = input<string | null>(null);
  /** Texto de progreso ya resuelto (viene de `workflow.progressMessage()`). */
  readonly progressMessage = input<string | null>(null);
  /** Usa `app-job-progress-card` en progress en vez del `<p>` simple. */
  readonly useProgressCard = input<boolean>(false);
  /** Job id pasado a la tarjeta de progreso cuando `useProgressCard` es true. */
  readonly jobId = input<string | null>(null);
  /** Porcentaje pasado a la tarjeta de progreso cuando `useProgressCard` es true. */
  readonly progressPercentage = input<number>(0);
  /** Clave i18n del aria-label de la tarjeta de progreso. */
  readonly progressAriaLabelKey = input<string | null>(null);
  /** Mensaje de error ya resuelto (viene de `workflow.errorMessage()`). */
  readonly errorMessage = input<string | null>(null);
}

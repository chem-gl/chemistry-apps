// scientific-panel.component.ts: Contenedor único de paneles entrada/resultado.
// Estilo en clases globales `.sci-panel*` (styles.scss) para que nuevas apps lo
// reutilicen sin CSS propio: `<app-scientific-panel kind="entry"
// titleKey="tunnel.form.title" ariaLabelKey="tunnel.form.ariaLabel">…`.

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-scientific-panel',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './scientific-panel.component.html',
  styleUrl: './scientific-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScientificPanelComponent {
  /** `entry` (formulario) o `result` (salida/progreso). Solo semántica. */
  readonly kind = input.required<'entry' | 'result'>();
  /** Clave i18n del `<h3>`; omitir si el panel no lleva título. */
  readonly titleKey = input<string | null>(null);
  /** Clave i18n del `aria-label` de la sección. */
  readonly ariaLabelKey = input<string | null>(null);
  /** Fija el panel al hacer scroll (entradas con resultados largos). */
  readonly sticky = input<boolean>(false);
  /** Limita la altura con scroll interno (combinar con `sticky`). */
  readonly scrollable = input<boolean>(false);
}

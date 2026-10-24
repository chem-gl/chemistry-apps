// scientific-app-header.component.ts: Cabecera-tarjeta única de las apps científicas.
// Resuelve título/descripción desde `scientificApps.<appKey>` y el icono desde el
// registro de apps, de modo que las pantallas no dupliquen markup ni estilos.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  findScientificAppRouteItemByRouteKey,
  scientificAppDescriptionKey,
  scientificAppTitleKey,
} from '../../scientific-apps.config';

@Component({
  selector: 'app-scientific-app-header',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './scientific-app-header.component.html',
  styleUrl: './scientific-app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScientificAppHeaderComponent {
  /** Clave de `SCIENTIFIC_APP_ROUTE_ITEMS` (`easy-rate`, `cadma-py`, ...). */
  readonly appKey = input.required<string>();
  /** Muestra el botón de documentación. */
  readonly showDoc = input<boolean>(false);
  /** Etiqueta opcional de una acción secundaria (solo CADMA Py). */
  readonly secondaryActionLabelKey = input<string | null>(null);

  readonly openDocs = output<void>();
  readonly secondaryAction = output<void>();

  /** Nombre corto de la app (`scientificApps.<key>.title`). */
  readonly titleKey = computed<string>(() => scientificAppTitleKey(this.appKey()));
  /** Descripción de una línea (`scientificApps.<key>.description`). */
  readonly descriptionKey = computed<string>(() => scientificAppDescriptionKey(this.appKey()));
  readonly iconAsset = computed<string | null>(
    () => findScientificAppRouteItemByRouteKey(this.appKey())?.iconAsset ?? null,
  );
}

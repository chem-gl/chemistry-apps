// app-card-thumbnail.component.ts: Miniatura dual para tarjetas de apps cientificas.
// mode=screenshot muestra la captura real en la tarjeta principal del hub;
// mode=illustration (o sin captura / error de carga) muestra la ilustración representativa.

import { Component, computed, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ScientificAppRouteItem } from '../../scientific-apps.config';
import { AppIllustrationComponent } from '../app-illustration/app-illustration.component';

@Component({
  selector: 'app-card-thumbnail',
  standalone: true,
  imports: [TranslocoPipe, AppIllustrationComponent],
  templateUrl: './app-card-thumbnail.component.html',
  styleUrl: './app-card-thumbnail.component.scss',
})
export class AppCardThumbnailComponent {
  readonly appItem = input.required<ScientificAppRouteItem>();
  readonly mode = input<'screenshot' | 'illustration'>('screenshot');

  private readonly screenshotFailed = signal<boolean>(false);

  readonly showScreenshot = computed<boolean>(
    () =>
      this.mode() === 'screenshot' &&
      (this.appItem().thumbnailScreenshot?.length ?? 0) > 0 &&
      !this.screenshotFailed(),
  );

  onScreenshotError(): void {
    this.screenshotFailed.set(true);
  }
}

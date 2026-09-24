// app-card-thumbnail.component.ts: Miniatura triple para tarjetas de apps cientificas.
// mode=screenshot muestra la captura real; mode=icon muestra el icono circular
// de la app junto al titulo (hub); mode=illustration (o sin asset / error de
// carga) muestra la ilustración representativa.

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
  readonly mode = input<'screenshot' | 'illustration' | 'icon'>('screenshot');

  private readonly screenshotFailed = signal<boolean>(false);
  private readonly iconFailed = signal<boolean>(false);

  readonly showScreenshot = computed<boolean>(
    () =>
      this.mode() === 'screenshot' &&
      (this.appItem().thumbnailScreenshot?.length ?? 0) > 0 &&
      !this.screenshotFailed(),
  );

  readonly showIcon = computed<boolean>(
    () =>
      this.mode() === 'icon' &&
      (this.appItem().iconAsset?.length ?? 0) > 0 &&
      !this.iconFailed(),
  );

  onScreenshotError(): void {
    this.screenshotFailed.set(true);
  }

  onIconError(): void {
    this.iconFailed.set(true);
  }
}

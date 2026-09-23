import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { JobAccessModeService } from '../../../auth/job-access-mode.service';

@Component({
  selector: 'app-open-mode-banner',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './open-mode-banner.component.html',
  styleUrl: './open-mode-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenModeBannerComponent {
  private readonly accessMode = inject(JobAccessModeService, { optional: true });
  readonly isOpenMode = computed(() => this.accessMode?.isOpenMode() ?? false);
}

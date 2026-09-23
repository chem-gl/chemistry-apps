import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
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
  readonly isOpenMode = computed(() => JobAccessModeService.current?.isOpenMode() ?? false);
}

import { Injectable, computed, inject } from '@angular/core';
import { IdentitySessionService } from './identity-session.service';

@Injectable({ providedIn: 'root' })
export class JobAccessModeService {
  static current: Pick<JobAccessModeService, 'isOpenMode'> | null = null;
  private readonly session = inject(IdentitySessionService);

  readonly isOpenMode = computed(() => this.session.status() === 'anonymous');
  readonly mode = computed<'account' | 'open'>(() => (this.isOpenMode() ? 'open' : 'account'));

  constructor() {
    JobAccessModeService.current = this;
  }
}

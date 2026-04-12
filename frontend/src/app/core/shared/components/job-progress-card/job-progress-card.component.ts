// job-progress-card.component.ts: Componente reutilizable para mostrar progreso de jobs científicos.

import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-job-progress-card',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './job-progress-card.component.html',
  styleUrl: './job-progress-card.component.scss',
})
export class JobProgressCardComponent {
  @Input() jobId: string | null = null;
  @Input() progressPercentage: number = 0;
  @Input() progressMessage: string = '';
  @Input() progressAriaLabel: string = 'Scientific job progress';
}

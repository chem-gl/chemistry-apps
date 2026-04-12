// job-filters.component.ts: Filtros reutilizables por estado y app para pantallas de jobs.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';

export type JobFilterOption = {
  value: string;
  labelKey: string;
};

@Component({
  selector: 'app-job-filters',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslocoPipe],
  templateUrl: './job-filters.component.html',
  styleUrl: './job-filters.component.scss',
})
export class JobFiltersComponent {
  @Input() statusOptions: ReadonlyArray<JobFilterOption> = [];
  @Input() pluginOptions: ReadonlyArray<string> = [];
  @Input() selectedStatus: string = 'all';
  @Input() selectedPluginName: string = 'all';
  @Input() ariaLabel: string = 'Job filters';

  @Output() readonly statusChanged = new EventEmitter<string>();
  @Output() readonly pluginChanged = new EventEmitter<string>();
}

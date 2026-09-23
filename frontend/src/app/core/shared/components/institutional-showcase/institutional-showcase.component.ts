import { CommonModule } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  DeveloperEntry,
  getDeveloperEntries,
  getPublicationEntries,
  PublicationEntry,
} from '../../institutional-data';

@Component({
  selector: 'app-institutional-showcase',
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './institutional-showcase.component.html',
  styleUrl: './institutional-showcase.component.scss',
})
export class InstitutionalShowcaseComponent {
  readonly variant = input<'login' | 'hub'>('login');
  readonly developers = signal<DeveloperEntry[]>(getDeveloperEntries());
  readonly publications = signal<PublicationEntry[]>(getPublicationEntries());

  onDeveloperPhotoError(event: Event, developer: DeveloperEntry): void {
    const image = event.target as HTMLImageElement;
    image.style.display = 'none';
    developer.photoUrl = null;
  }
}

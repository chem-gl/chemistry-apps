// app-illustration.component.ts: Ilustración SVG inline que representa a cada app científica.
// Se usa en vistas secundarias y como fallback cuando la captura no está disponible.

import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const ILLUSTRATION_PATHS: Record<string, string> = {
  'molar-fractions':
    '<path d="M8 40h32M10 40V8"/><path d="M10 33c7 0 8-19 14-19s7 19 14 19"/><circle cx="24" cy="14" r="2"/>',
  tunnel:
    '<path d="M19 6v36M29 6v36"/><path d="M4 24c4-6 8 6 12 0s4-4 6-4"/><path d="M32 18l6 6-6 6"/>',
  'easy-rate':
    '<path d="M8 34a16 16 0 0 1 32 0"/><path d="M24 34L35 21"/><circle cx="24" cy="34" r="2.5"/><path d="M10 40h28"/>',
  marcus:
    '<path d="M8 6c9 18 9 18 16 36M40 6c-9 18-9 18-16 36"/><circle cx="24" cy="24" r="2.5"/>',
  smileit:
    '<path d="M24 5l15 9v18l-15 9-15-9V14z"/><path d="M24 5v11m0 0l-9 6m9-6l9 6"/><circle cx="24" cy="16" r="2"/>',
  'sa-score':
    '<path d="M17 12h21M17 24h21M17 36h13"/><path d="M5 10l3.5 3.5L14 7"/><path d="M5 22l3.5 3.5L14 19"/>',
  'toxicity-properties':
    '<path d="M24 4l15 6v11c0 10-6.5 17-15 21-8.5-4-15-11-15-21V10z"/><path d="M24 15v9"/><circle cx="24" cy="30" r="1.6"/>',
  'cadma-py':
    '<path d="M24 5l19 9.5L24 24 5 14.5z"/><path d="M9 24l15 7.5L39 24"/><path d="M9 32l15 7.5L39 32"/>',
};

const DEFAULT_ILLUSTRATION =
  '<path d="M21 5h6M23 5v15l-13 21h28L25 20V5"/><path d="M16 31h16"/>';

@Component({
  selector: 'app-app-illustration',
  standalone: true,
  templateUrl: './app-illustration.component.html',
  styleUrl: './app-illustration.component.scss',
})
export class AppIllustrationComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly appKey = input<string>('');
  readonly size = input<number>(40);

  readonly svgContent = computed<SafeHtml>(() => {
    const paths = ILLUSTRATION_PATHS[this.appKey()] ?? DEFAULT_ILLUSTRATION;
    return this.sanitizer.bypassSecurityTrustHtml(paths);
  });
}

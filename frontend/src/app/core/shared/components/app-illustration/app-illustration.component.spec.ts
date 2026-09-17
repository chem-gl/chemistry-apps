// app-illustration.component.spec.ts: Pruebas de la ilustración SVG por app.

import { TestBed } from '@angular/core/testing';
import { AppIllustrationComponent } from './app-illustration.component';

describe('AppIllustrationComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppIllustrationComponent],
    }).compileComponents();
  });

  it('resuelve un svg para cada app conocida y respeta el tamaño', () => {
    const fixture = TestBed.createComponent(AppIllustrationComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('appKey', 'molar-fractions');
    fixture.componentRef.setInput('size', 72);

    expect(component.size()).toBe(72);
    expect(String(component.svgContent())).toContain('<path');
  });

  it('usa la ilustración por defecto con una clave desconocida', () => {
    const fixture = TestBed.createComponent(AppIllustrationComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('appKey', 'unknown-app');

    expect(String(component.svgContent())).toContain('<path');
  });
});

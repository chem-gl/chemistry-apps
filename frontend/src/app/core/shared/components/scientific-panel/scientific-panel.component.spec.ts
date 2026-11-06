// scientific-panel.component.spec.ts: Estructura del contenedor único de paneles.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScientificPanelComponent } from './scientific-panel.component';

describe('ScientificPanelComponent', () => {
  let fixture: ComponentFixture<ScientificPanelComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScientificPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ScientificPanelComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('kind', 'entry');
  });

  it('pinta el título cuando hay titleKey', () => {
    fixture.componentRef.setInput('titleKey', 'tunnel.form.title');
    fixture.detectChanges();

    expect(element.querySelector('.sci-panel-title')?.textContent?.trim()).toBe('Data Entry');
  });

  it('omite el título sin titleKey', () => {
    fixture.detectChanges();

    expect(element.querySelector('.sci-panel-title')).toBeNull();
  });

  it('aplica sticky y scroll bajo demanda', () => {
    fixture.componentRef.setInput('sticky', true);
    fixture.componentRef.setInput('scrollable', true);
    fixture.detectChanges();

    const section = element.querySelector('section');
    expect(section?.classList.contains('sci-panel--sticky')).toBe(true);
    expect(section?.classList.contains('sci-panel--scroll')).toBe(true);
  });
});

// scientific-app-header.component.spec.ts: Pruebas de la cabecera-tarjeta compartida.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScientificAppHeaderComponent } from './scientific-app-header.component';

describe('ScientificAppHeaderComponent', () => {
  let fixture: ComponentFixture<ScientificAppHeaderComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScientificAppHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ScientificAppHeaderComponent);
    element = fixture.nativeElement as HTMLElement;
  });

  it('renderiza el nombre corto y la descripción de la app, sin duplicar títulos', () => {
    fixture.componentRef.setInput('appKey', 'tunnel');
    fixture.detectChanges();

    const headings = element.querySelectorAll('h2');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim()).toBe('Tunnel Effect');
    expect(element.querySelectorAll('p')).toHaveLength(1);
    expect(element.querySelector('p')?.textContent?.trim()).toBe(
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    );
  });

  it('pinta solo el logo: sin código de módulo ni texto en la franja', () => {
    fixture.componentRef.setInput('appKey', 'cadma-py');
    fixture.detectChanges();

    expect(element.querySelector<HTMLImageElement>('.module-icon')?.getAttribute('src')).toBe(
      'assets/cadmapy_v3_noboxes.png',
    );
    expect(element.querySelector('.module-strip')?.textContent?.trim()).toBe('');
  });

  it('omite el logo cuando la app no tiene icono registrado', () => {
    fixture.componentRef.setInput('appKey', 'unknown-app');
    fixture.detectChanges();

    expect(element.querySelector('.module-icon')).toBeNull();
    expect(element.querySelector('.doc-btn')).toBeNull();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe('scientificApps.unknown-app.title');
  });

  it('emite openDocs al pulsar el botón de documentación', () => {
    fixture.componentRef.setInput('appKey', 'tunnel');
    fixture.componentRef.setInput('showDoc', true);
    fixture.detectChanges();

    const emitted: void[] = [];
    fixture.componentInstance.openDocs.subscribe(() => emitted.push(undefined));

    const docButton = element.querySelector<HTMLButtonElement>('.doc-btn');
    expect(docButton?.getAttribute('aria-label')).toBeTruthy();
    docButton?.click();

    expect(emitted).toHaveLength(1);
  });

  it('emite secondaryAction con la etiqueta indicada y muestra ambos botones', () => {
    fixture.componentRef.setInput('appKey', 'cadma-py');
    fixture.componentRef.setInput('showDoc', true);
    fixture.componentRef.setInput('secondaryActionLabelKey', 'cadmaPy.hero.protocolDiagram');
    fixture.detectChanges();

    const actions = element.querySelectorAll<HTMLButtonElement>('.module-actions .doc-btn');
    expect(actions).toHaveLength(2);

    let secondaryEmissions = 0;
    fixture.componentInstance.secondaryAction.subscribe(() => (secondaryEmissions += 1));
    actions[0].click();

    expect(secondaryEmissions).toBe(1);
  });
});

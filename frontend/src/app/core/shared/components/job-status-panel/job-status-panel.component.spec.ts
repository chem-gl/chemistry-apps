// job-status-panel.component.spec.ts: Pruebas del panel de estado compartido de jobs.
// Cubre las 4 ramas (idle, dispatching, progress simple/card, error) con stubs mínimos.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JobStatusPanelComponent } from './job-status-panel.component';

describe('JobStatusPanelComponent', () => {
  let fixture: ComponentFixture<JobStatusPanelComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobStatusPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JobStatusPanelComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('activeSection', 'idle');
  });

  it('muestra la tarjeta idle con título y pista de ejecución', () => {
    fixture.componentRef.setInput('titleKey', 'tunnel.result.ariaLabel');
    fixture.componentRef.setInput('runHintKey', 'tunnel.actions.run');
    fixture.detectChanges();

    expect(element.querySelector('.result-empty-card')).not.toBeNull();
    expect(element.querySelector('.result-empty-card strong')?.textContent?.trim()).toBe(
      'Results and progress',
    );
    expect(element.querySelector('.result-empty-hint')?.textContent?.trim()).toBe(
      'Data ok, Run Tunnel',
    );
  });

  it('oculta la tarjeta idle cuando showIdleWhen es false', () => {
    fixture.componentRef.setInput('titleKey', 'tunnel.result.ariaLabel');
    fixture.componentRef.setInput('runHintKey', 'tunnel.actions.run');
    fixture.componentRef.setInput('showIdleWhen', false);
    fixture.detectChanges();

    expect(element.querySelector('.result-empty-card')).toBeNull();
  });

  it('muestra el mensaje de envío solo en dispatching con submittingKey', () => {
    fixture.componentRef.setInput('activeSection', 'dispatching');
    fixture.componentRef.setInput('submittingKey', 'tunnel.result.submitting');
    fixture.detectChanges();

    expect(element.querySelector('.status-message')?.textContent?.trim()).toBe(
      'Submitting tunnel effect job to backend...',
    );
  });

  it('no pinta nada en dispatching sin submittingKey', () => {
    fixture.componentRef.setInput('activeSection', 'dispatching');
    fixture.detectChanges();

    expect(element.querySelector('.status-message')).toBeNull();
  });

  it('muestra el progreso simple como párrafo de estado', () => {
    fixture.componentRef.setInput('activeSection', 'progress');
    fixture.componentRef.setInput('progressMessage', 'Working 42%');
    fixture.detectChanges();

    const status = element.querySelector('.status-message');
    expect(status?.textContent?.trim()).toBe('Working 42%');
    expect(element.querySelector('app-job-progress-card')).toBeNull();
  });

  it('muestra el error con role alert', () => {
    fixture.componentRef.setInput('activeSection', 'error');
    fixture.componentRef.setInput('errorMessage', 'Something failed');
    fixture.detectChanges();

    const error = element.querySelector('.error-message');
    expect(error?.textContent?.trim()).toBe('Something failed');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  it('usa la tarjeta de progreso cuando useProgressCard es true', () => {
    fixture.componentRef.setInput('activeSection', 'progress');
    fixture.componentRef.setInput('useProgressCard', true);
    fixture.componentRef.setInput('jobId', 'job-123');
    fixture.componentRef.setInput('progressPercentage', 47);
    fixture.componentRef.setInput('progressMessage', 'Working');
    fixture.componentRef.setInput('progressAriaLabelKey', 'saScore.result.ariaProgressLabel');
    fixture.detectChanges();

    const card = element.querySelector('app-job-progress-card');
    expect(card).not.toBeNull();
    expect(element.textContent).toContain('job-123');
    expect(element.textContent).toContain('47%');
    expect(element.textContent).toContain('Working');
    expect(element.querySelector('p.status-message')).toBeNull();
  });
});

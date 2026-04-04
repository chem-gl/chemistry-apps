// job-progress-card.component.spec.ts: Pruebas unitarias del componente compartido de progreso.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JobProgressCardComponent } from './job-progress-card.component';

describe('JobProgressCardComponent', () => {
  let fixture: ComponentFixture<JobProgressCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobProgressCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JobProgressCardComponent);
  });

  it('renders current percentage and message', () => {
    const component = fixture.componentInstance;
    component.jobId = 'job-123';
    component.progressPercentage = 47;
    component.progressMessage = 'Working';

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('job-123');
    expect(element.textContent).toContain('47%');
    expect(element.textContent).toContain('Working');
  });
});

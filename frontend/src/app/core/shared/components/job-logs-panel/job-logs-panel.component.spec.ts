// job-logs-panel.component.spec.ts: Pruebas unitarias del componente compartido de logs.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JobLogEntryView } from '../../../api/jobs-api.service';
import { JobLogsPanelComponent } from './job-logs-panel.component';

describe('JobLogsPanelComponent', () => {
  let fixture: ComponentFixture<JobLogsPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobLogsPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JobLogsPanelComponent);
  });

  it('renders logs with payload when present', () => {
    const component = fixture.componentInstance;
    const logs: JobLogEntryView[] = [
      {
        jobId: 'job-1',
        eventIndex: 1,
        level: 'info',
        source: 'worker',
        message: 'Started',
        payload: { phase: 'init' },
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    component.logs = logs;
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Execution logs');
    expect(element.textContent).toContain('1');
    expect(element.textContent).not.toContain('Started');

    component.toggleExpanded();
    fixture.detectChanges();

    expect(element.textContent).toContain('Started');
    expect(element.textContent).toContain('worker');
    expect(element.querySelector('.log-payload')).not.toBeNull();
  });
});

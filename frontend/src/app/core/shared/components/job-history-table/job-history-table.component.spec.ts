import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';
import { JobAccessModeService } from '../../../auth/job-access-mode.service';
import { LocalResultRecord } from '../../local-results.store';
import { JobHistoryTableComponent } from './job-history-table.component';

function record(jobId: string, status: string, expired = false): LocalResultRecord {
  return {
    jobId,
    pluginName: 'molar-fractions',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status,
    progressPercentage: 100,
    parameters: {},
    resultSummary: { value: jobId },
    expired,
  };
}

describe('JobHistoryTableComponent', () => {
  let fixture: ComponentFixture<JobHistoryTableComponent>;

  beforeEach(async () => {
    JobAccessModeService.current = { isOpenMode: signal(true) };
    await TestBed.configureTestingModule({
      imports: [JobHistoryTableComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
    }).compileComponents();
    fixture = TestBed.createComponent(JobHistoryTableComponent);
  });

  it('lists local history, marks expired records, and emits open/remove actions', () => {
    const component = fixture.componentInstance;
    component.localRecords = [record('pending-job', 'pending'), record('expired-job', 'failed', true)];
    const openJob = vi.spyOn(component.openJob, 'emit');
    const deleteJob = vi.spyOn(component.deleteJob, 'emit');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('expired');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    expect(openJob).toHaveBeenCalledWith('pending-job');
    expect(deleteJob).toHaveBeenCalledWith('pending-job');
  });
});

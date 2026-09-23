import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';
import { JobAccessModeService } from '../auth/job-access-mode.service';
import { LocalResultsStore } from '../shared/local-results.store';

class TestWorkflowService extends BaseJobWorkflowService<string> {
  protected override get defaultProgressMessage(): string {
    return 'Waiting';
  }

  dispatch(): void {}
  loadHistory(): void {
    this.loadHistoryForPlugin('test-plugin');
  }

  protected fetchFinalResult(jobId: string): void {
    this.resultData.set(`final:${jobId}`);
  }

  start(jobId: string): void {
    this.startProgressStream(jobId);
  }

  startWithoutLogs(jobId: string): void {
    this.startProgressOnlyStream(jobId);
  }

  historical(jobId: string): void {
    this.loadHistoricalLogs(jobId);
  }

  outcome(
    jobId: string,
    response: { status?: string; error_trace?: string | null },
    result: string | null,
    options?: { checkFailed?: boolean; loadLogs?: boolean; loadHistoryAfter?: boolean },
  ): void {
    this.handleJobOutcome(jobId, response, () => result, options);
  }

  dispatchResponse(response: { id: string; status?: string }, result: string | null): void {
    this.handleDispatchJobResponse(response, () => result, 'test');
  }

  transientResponse(response: { id: string; status?: string }, result: string | null): void {
    this.handleTransientDispatchJobResponse(response, () => result, 'test');
  }

  download(
    source: Observable<DownloadedReportFile>,
    label: string,
  ): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(source, label);
  }

  summary(status: string): string {
    return this.buildHistoricalSummaryMessage(status);
  }
}

function makeJob(id: string, updatedAt: string): ScientificJobView {
  return { id, updated_at: updatedAt } as ScientificJobView;
}

function makeLog(eventIndex: number): JobLogEntryView {
  return {
    eventIndex,
    level: 'info',
    message: `log-${eventIndex}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as JobLogEntryView;
}

describe('BaseJobWorkflowService', () => {
  let service: TestWorkflowService;
  let api: {
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      streamJobEvents: vi.fn(() => of({ progress_percentage: 25, progress_message: 'Working' })),
      streamJobLogEvents: vi.fn(() => of(makeLog(2), makeLog(1))),
      pollJobUntilCompleted: vi.fn(() => of({ progress_percentage: 100 })),
      getJobLogs: vi.fn(() => of({ results: [makeLog(2), makeLog(1)] } as JobLogsPageView)),
      listJobs: vi.fn(() => of([makeJob('old', '2026-01-01'), makeJob('new', '2026-02-01')])),
      deleteJob: vi.fn(() => of({})),
    };
    const injector = Injector.create({
      providers: [
        {
          provide: JobAccessModeService,
          useValue: { isOpenMode: () => false, mode: () => 'account' },
        },
        {
          provide: LocalResultsStore,
          useValue: {
            list: () => [],
            save: () => undefined,
            remove: () => undefined,
            clear: () => undefined,
          },
        },
        TestWorkflowService,
        { provide: JobsApiService, useValue: api as unknown as JobsApiService },
      ],
    });
    service = runInInjectionContext(injector, () => injector.get(TestWorkflowService));
  });

  it('tracks progress, deduplicates logs, and fetches the final result on stream completion', () => {
    const progress$ = new Subject<JobProgressSnapshotView>();
    api.streamJobEvents.mockReturnValue(progress$.asObservable());
    service.start('job-1');

    progress$.next({
      progress_percentage: 40,
      progress_message: 'Running',
    } as JobProgressSnapshotView);
    expect(service.progressPercentage()).toBe(40);
    expect(service.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progress$.complete();
    expect(service.resultData()).toBe('final:job-1');
  });

  it('falls back to polling and reports polling failures', () => {
    api.streamJobEvents.mockReturnValue(throwError(() => new Error('sse down')));
    api.pollJobUntilCompleted.mockReturnValue(throwError(() => new Error('poll down')));

    service.startWithoutLogs('job-2');

    expect(service.activeSection()).toBe('error');
    expect(service.errorMessage()).toBe('Unable to track progress: poll down');
  });

  it('loads history, deletes jobs, and resets when the current job is deleted', () => {
    service.loadHistory();
    expect(service.historyJobs().map((job) => job.id)).toEqual(['new', 'old']);
    service.currentJobId.set('new');
    service.deleteHistoryJob('new');
    expect(service.currentJobId()).toBeNull();
    expect(service.activeSection()).toBe('idle');
  });

  it('keeps state usable when historical logs or history loading fail', () => {
    api.getJobLogs.mockReturnValue(throwError(() => new Error('logs unavailable')));
    api.listJobs.mockReturnValue(throwError(() => new Error('history unavailable')));
    service.historical('job-3');
    service.loadHistory();
    expect(service.jobLogs()).toEqual([]);
    expect(service.isHistoryLoading()).toBe(false);
  });

  it('handles failed, invalid, and successful outcomes according to options', () => {
    service.outcome('failed', { status: 'failed', error_trace: null }, null);
    expect(service.errorMessage()).toBe('Job ended with error.');

    service.outcome('invalid', { status: 'completed' }, null, { loadLogs: false });
    expect(service.errorMessage()).toBe('Result payload is invalid.');

    service.outcome('ok', { status: 'completed' }, 'result', {
      loadLogs: false,
      loadHistoryAfter: false,
    });
    expect(service.resultData()).toBe('result');
    expect(service.activeSection()).toBe('result');
  });

  it('handles immediate and transient dispatch responses, including invalid payloads', () => {
    service.dispatchResponse({ id: 'complete', status: 'completed' }, 'done');
    expect(service.activeSection()).toBe('result');
    expect(service.resultData()).toBe('done');

    service.transientResponse({ id: 'invalid', status: 'completed' }, null);
    expect(service.errorMessage()).toBe('The completed job payload is invalid for test.');

    service.transientResponse({ id: 'running', status: 'running' }, 'ignored');
    expect(service.activeSection()).toBe('progress');
  });

  it('guards downloads, preserves unknown errors, and resets all transient state', () => {
    expect(() => service.download(of({} as DownloadedReportFile), 'CSV')).toThrow(
      'No job selected for download.',
    );
    service.currentJobId.set('job-4');
    service
      .download(
        throwError(() => 'offline'),
        'CSV',
      )
      .subscribe({ error: () => undefined });
    expect(service.exportErrorMessage()).toBe('Unable to download CSV: Unknown error.');
    expect(service.isExporting()).toBe(false);

    service.activeSection.set('error');
    service.resultData.set('stale');
    service.reset();
    expect(service.activeSection()).toBe('idle');
    expect(service.resultData()).toBeNull();
    expect(service.progressMessage()).toBe('Waiting');
  });

  it('builds summaries for every non-terminal status and unsubscribes on destroy', () => {
    expect(service.summary('pending')).toContain('pending');
    expect(service.summary('running')).toContain('running');
    expect(service.summary('paused')).toContain('paused');
    expect(service.summary('cancelled')).toContain('no final result');
    service.start('job-5');
    service.ngOnDestroy();
    expect(api.streamJobEvents).toHaveBeenCalledWith('job-5');
  });
});

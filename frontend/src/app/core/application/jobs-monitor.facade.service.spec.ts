// jobs-monitor.facade.service.spec.ts: Pruebas unitarias del facade del monitor de jobs.

import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { ScientificJob } from '../api/generated';
import { JobsApiService } from '../api/jobs-api.service';
import { JobsMonitorFacadeService } from './jobs-monitor.facade.service';

function makeScientificJob(overrides: Partial<ScientificJob> = {}): ScientificJob {
  return {
    id: 'job-1',
    job_hash: 'hash-1',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: 'pending',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: 'pending',
    progress_message: 'Pending',
    progress_event_index: 1,
    parameters: null,
    results: null,
    error_trace: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('JobsMonitorFacadeService', () => {
  let facadeService: JobsMonitorFacadeService;
  let jobsApiServiceMock: {
    listJobs: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      listJobs: vi.fn((): Observable<ScientificJob[]> => of([])),
      getScientificJobStatus: vi.fn(
        (jobId: string): Observable<ScientificJob> =>
          of(makeScientificJob({ id: jobId, status: 'completed' })),
      ),
      getJobLogs: vi.fn(() =>
        of({
          jobId: 'job-1',
          count: 1,
          nextAfterEventIndex: 1,
          results: [
            {
              jobId: 'job-1',
              eventIndex: 1,
              level: 'info',
              source: 'tests.monitor',
              message: 'Evento de prueba',
              payload: {},
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        JobsMonitorFacadeService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    facadeService = TestBed.inject(JobsMonitorFacadeService);
  });

  it('loads and classifies active, completed and failed jobs', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'pending-1', status: 'pending' }),
        makeScientificJob({ id: 'running-1', status: 'running' }),
        makeScientificJob({ id: 'completed-1', status: 'completed' }),
        makeScientificJob({ id: 'failed-1', status: 'failed' }),
      ]),
    );

    facadeService.loadJobs();

    expect(facadeService.activeJobs().length).toBe(2);
    expect(facadeService.completedJobs().length).toBe(1);
    expect(facadeService.failedJobs().length).toBe(1);
    expect(facadeService.finishedJobs().length).toBe(2);
    expect(facadeService.isLoading()).toBe(false);
  });

  it('sends status filter when selecting a specific status', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(of([]));

    facadeService.setStatusFilter('completed');

    expect(jobsApiServiceMock.listJobs).toHaveBeenCalledWith({
      status: 'completed',
      pluginName: undefined,
    });
  });

  it('builds sorted unique plugin options from loaded jobs', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ plugin_name: 'calculator' }),
        makeScientificJob({ plugin_name: 'thermo', id: 'job-2' }),
        makeScientificJob({ plugin_name: 'calculator', id: 'job-3' }),
      ]),
    );

    facadeService.loadJobs();

    expect(facadeService.pluginOptions()).toEqual(['all', 'calculator', 'thermo']);
  });

  it('loads selected job details and logs', () => {
    facadeService.openJobDetails('job-1');

    expect(facadeService.isDetailsLoading()).toBe(false);
    expect(facadeService.selectedJobId()).toBe('job-1');
    expect(facadeService.selectedJob()?.id).toBe('job-1');
    expect(facadeService.selectedJobLogs().length).toBe(1);
    expect(facadeService.selectedJobLogs()[0].source).toBe('tests.monitor');
  });
});

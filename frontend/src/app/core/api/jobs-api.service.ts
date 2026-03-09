// jobs-api.service.ts: Wrapper tipado que encapsula el cliente generado de OpenAPI

import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { JobCreate, JobsService, ScientificJob } from './generated';

export interface CalculatorParams {
  op: 'add' | 'sub' | 'mul' | 'div';
  a: number;
  b: number;
}

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly jobsClient = inject(JobsService);

  dispatchCalculatorJob(
    params: CalculatorParams,
    version: string = '1.0.0',
  ): Observable<ScientificJob> {
    const payload: JobCreate = {
      plugin_name: 'calculator',
      version,
      parameters: params,
    };
    return this.jobsClient.jobsCreate(payload).pipe(shareReplay(1));
  }

  getJobStatus(jobId: string): Observable<ScientificJob> {
    return this.jobsClient.jobsRetrieve(jobId);
  }

  pollJobUntilCompleted(jobId: string, intervalMs: number = 1000): Observable<ScientificJob> {
    return new Observable((observer) => {
      const pollInterval = setInterval(() => {
        this.getJobStatus(jobId).subscribe({
          next: (job) => {
            if (job.status === 'completed' || job.status === 'failed') {
              clearInterval(pollInterval);
              observer.next(job);
              observer.complete();
            }
          },
          error: (err) => {
            clearInterval(pollInterval);
            observer.error(err);
          },
        });
      }, intervalMs);

      return () => clearInterval(pollInterval);
    });
  }
}

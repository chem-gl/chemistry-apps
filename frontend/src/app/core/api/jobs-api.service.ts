// jobs-api.service.ts: Wrapper tipado que encapsula el cliente generado de OpenAPI

import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { CalculatorJobCreate, CalculatorJobResponse, CalculatorService } from './generated';

export interface CalculatorParams {
  op: 'add' | 'sub' | 'mul' | 'div';
  a: number;
  b: number;
}

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly calculatorClient = inject(CalculatorService);

  dispatchCalculatorJob(
    params: CalculatorParams,
    version: string = '1.0.0',
  ): Observable<CalculatorJobResponse> {
    const payload: CalculatorJobCreate = {
      version,
      op: params.op,
      a: params.a,
      b: params.b,
    };
    return this.calculatorClient.calculatorJobsCreate(payload).pipe(shareReplay(1));
  }

  getJobStatus(jobId: string): Observable<CalculatorJobResponse> {
    return this.calculatorClient.calculatorJobsRetrieve(jobId);
  }

  pollJobUntilCompleted(
    jobId: string,
    intervalMs: number = 1000,
  ): Observable<CalculatorJobResponse> {
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

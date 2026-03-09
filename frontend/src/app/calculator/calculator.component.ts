// calculator.component.ts: Componente demo de validacion E2E del flujo completo

import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ScientificJob } from '../core/api/generated';
import { CalculatorParams, JobsApiService } from '../core/api/jobs-api.service';

@Component({
  selector: 'app-calculator',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="calculator-container">
      <h2>Calculadora Científica (Demo E2E)</h2>

      <div class="input-group">
        <input type="number" [(ngModel)]="firstOperand" placeholder="Primer número" />
        <select [(ngModel)]="selectedOperation">
          <option value="add">Suma (+)</option>
          <option value="sub">Resta (-)</option>
          <option value="mul">Multiplicación (×)</option>
          <option value="div">División (÷)</option>
        </select>
        <input type="number" [(ngModel)]="secondOperand" placeholder="Segundo número" />
        <button (click)="dispatch()" [disabled]="isLoading()">Calcular</button>
      </div>

      @if (isLoading()) {
        <p class="status">Procesando job {{ currentJobId() }}...</p>
      }

      @if (lastResult(); as result) {
        <div class="result-panel">
          <h3>Resultado Final: {{ result.results?.['final_result'] }}</h3>
          <p>Job ID: {{ result.id }}</p>
          <p>Estado: {{ result.status }}</p>
          <p>Cache Hit: {{ result.cache_hit ? 'Sí' : 'No' }}</p>
          <p>Cache Miss: {{ result.cache_miss ? 'Sí' : 'No' }}</p>
          <p>Hash: {{ result.job_hash }}</p>
          @if (result.results?.metadata; as meta) {
            <p>Operación: {{ meta.operation_used }}</p>
            <p>Operandos: {{ meta.operand_a }} y {{ meta.operand_b }}</p>
          }
        </div>
      }

      @if (errorMessage()) {
        <p class="error">{{ errorMessage() }}</p>
      }
    </div>
  `,
  styles: `
    .calculator-container {
      max-width: 600px;
      margin: 2rem auto;
      padding: 1.5rem;
      border: 1px solid #ccc;
      border-radius: 8px;
    }
    .input-group {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    input,
    select,
    button {
      padding: 0.5rem;
      font-size: 1rem;
    }
    .result-panel {
      background: #f0f0f0;
      padding: 1rem;
      border-radius: 4px;
      margin-top: 1rem;
    }
    .status {
      font-style: italic;
      color: #0066cc;
    }
    .error {
      color: red;
      font-weight: bold;
    }
  `,
})
export class CalculatorComponent {
  private readonly jobsApi = inject(JobsApiService);

  firstOperand = 5;
  secondOperand = 3;
  selectedOperation: 'add' | 'sub' | 'mul' | 'div' = 'add';

  isLoading = signal(false);
  currentJobId = signal<string | null>(null);
  lastResult = signal<ScientificJob | null>(null);
  errorMessage = signal<string | null>(null);

  dispatch(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.lastResult.set(null);

    const params: CalculatorParams = {
      op: this.selectedOperation,
      a: this.firstOperand,
      b: this.secondOperand,
    };

    this.jobsApi.dispatchCalculatorJob(params).subscribe({
      next: (job) => {
        this.currentJobId.set(job.id || null);

        if (job.status === 'completed') {
          this.isLoading.set(false);
          this.lastResult.set(job);
        } else {
          this.pollJobStatus(job.id!);
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(`Error despachando job: ${err.message}`);
      },
    });
  }

  private pollJobStatus(jobId: string): void {
    this.jobsApi.pollJobUntilCompleted(jobId, 500).subscribe({
      next: (job) => {
        this.isLoading.set(false);
        this.lastResult.set(job);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(`Error consultando job: ${err.message}`);
      },
    });
  }
}

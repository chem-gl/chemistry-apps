// calculator.component.ts: Calculadora científica con progreso en tiempo real por SSE.
// Soporta 6 operaciones: add, sub, mul, div, pow, factorial.
// Muestra secciones de avance con barra de progreso, etapa y mensaje antes del resultado.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CalculatorWorkflowService } from '../core/application/calculator-workflow.service';

@Component({
  selector: 'app-calculator',
  imports: [CommonModule, FormsModule],
  providers: [CalculatorWorkflowService],
  template: `
    <div class="calc-wrapper">
      <h2 class="calc-title">Calculadora Científica</h2>

      <!-- ── SECCIÓN: Formulario de entrada ── -->
      <section class="calc-form" aria-label="Parámetros de cálculo">
        <div class="form-row">
          <div class="form-group">
            <label for="operand-a">Operando A</label>
            <input
              id="operand-a"
              type="number"
              [ngModel]="firstOperand()"
              (ngModelChange)="firstOperand.set($event)"
              [disabled]="isProcessing()"
              placeholder="Ej. 5"
            />
          </div>

          <div class="form-group">
            <label for="operation">Operación</label>
            <select
              id="operation"
              [ngModel]="selectedOperation()"
              (ngModelChange)="selectedOperation.set($event)"
              [disabled]="isProcessing()"
            >
              @for (op of operations; track op.value) {
                <option [value]="op.value">{{ op.label }}</option>
              }
            </select>
          </div>

          @if (requiresSecondOperand()) {
            <div class="form-group">
              <label for="operand-b">Operando B</label>
              <input
                id="operand-b"
                type="number"
                [ngModel]="secondOperand()"
                (ngModelChange)="secondOperand.set($event)"
                [disabled]="isProcessing()"
                placeholder="Ej. 3"
              />
            </div>
          }
        </div>

        <button class="btn-primary" (click)="dispatch()" [disabled]="isProcessing()">
          @if (isProcessing()) {
            <span class="spinner" aria-hidden="true"></span> Procesando...
          } @else {
            Calcular
          }
        </button>
      </section>

      <!-- ── SECCIÓN: Enviando al backend ── -->
      @if (activeSection() === 'dispatching') {
        <section class="calc-section" aria-live="polite">
          <p class="status-text">Enviando job al servidor...</p>
        </section>
      }

      <!-- ── SECCIÓN: Progreso en tiempo real ── -->
      @if (activeSection() === 'progress') {
        <section
          class="calc-section progress-section"
          aria-live="polite"
          aria-label="Progreso del cálculo"
        >
          <h3 class="section-title">
            Progreso del job <span class="job-id-badge">{{ currentJobId() }}</span>
          </h3>

          <!-- Stepper de etapas -->
          <div class="stage-stepper" role="list">
            @for (step of stageSteps; track step) {
              <div
                class="stage-step"
                [class.step-done]="isStepDone(step)"
                [class.step-active]="isStepActive(step)"
                role="listitem"
                [attr.aria-current]="isStepActive(step) ? 'step' : null"
              >
                <div class="step-dot"></div>
                <span class="step-label">{{ stageLabel(step) }}</span>
              </div>
            }
          </div>

          <!-- Barra de progreso -->
          <div
            class="progress-bar-container"
            role="progressbar"
            [attr.aria-valuenow]="progressPercentage()"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="progress-bar-fill" [style.width.%]="progressPercentage()"></div>
          </div>
          <p class="progress-pct">{{ progressPercentage() }}%</p>

          <!-- Mensaje descriptivo -->
          <p class="progress-message">{{ progressMessage() }}</p>
        </section>
      }

      <!-- ── SECCIÓN: Resultado final ── -->
      @if (activeSection() === 'result') {
        @if (lastResult(); as job) {
          <section class="calc-section result-section" aria-label="Resultado del cálculo">
            <h3 class="section-title">Resultado</h3>

            <div class="result-value">
              {{ job.results?.final_result }}
            </div>

            <div class="result-meta-grid">
              <div class="meta-item">
                <span class="meta-label">Operación</span>
                <span class="meta-value">{{ job.results?.metadata?.operation_used }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Operando A</span>
                <span class="meta-value">{{ job.results?.metadata?.operand_a }}</span>
              </div>
              @if (job.results?.metadata?.operand_b !== null) {
                <div class="meta-item">
                  <span class="meta-label">Operando B</span>
                  <span class="meta-value">{{ job.results?.metadata?.operand_b }}</span>
                </div>
              }
              <div class="meta-item">
                <span class="meta-label">Estado</span>
                <span class="meta-value badge-status">{{ job.status }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Caché</span>
                <span class="meta-value">{{ job.cache_hit ? '✓ Hit' : '✗ Miss' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Job ID</span>
                <span class="meta-value mono">{{ job.id }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Versión</span>
                <span class="meta-value mono">{{ job.algorithm_version }}</span>
              </div>
            </div>

            <button class="btn-secondary" (click)="reset()">Nueva operación</button>
          </section>
        }
      }

      <!-- ── SECCIÓN: Error ── -->
      @if (activeSection() === 'error') {
        <section class="calc-section error-section" role="alert" aria-label="Error">
          <h3 class="section-title error-title">Error</h3>
          <p class="error-message">{{ errorMessage() }}</p>
          <button class="btn-secondary" (click)="reset()">Reintentar</button>
        </section>
      }
    </div>
  `,
  styles: `
    .calc-wrapper {
      max-width: 680px;
      margin: 2rem auto;
      padding: 2rem;
      font-family: system-ui, sans-serif;
      color: #1a1a1a;
    }

    .calc-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 0.75rem;
    }

    /* ── Formulario ── */
    .calc-form {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .form-row {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;
      min-width: 120px;
    }

    label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input,
    select {
      padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 1rem;
      background: #fff;
      transition: border-color 0.15s;
    }

    input:focus,
    select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    input:disabled,
    select:disabled {
      background: #f3f4f6;
      color: #9ca3af;
      cursor: not-allowed;
    }

    /* ── Botones ── */
    .btn-primary {
      padding: 0.6rem 1.5rem;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }

    .btn-primary:hover:not(:disabled) {
      background: #1d4ed8;
    }
    .btn-primary:disabled {
      background: #93c5fd;
      cursor: not-allowed;
    }

    .btn-secondary {
      margin-top: 1rem;
      padding: 0.5rem 1.25rem;
      background: transparent;
      color: #2563eb;
      border: 1px solid #2563eb;
      border-radius: 6px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-secondary:hover {
      background: #eff6ff;
    }

    /* ── Spinner ── */
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Secciones genéricas ── */
    .calc-section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .section-title {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: #374151;
    }

    .status-text {
      color: #6b7280;
      font-style: italic;
    }

    /* ── Sección de progreso ── */
    .progress-section {
      border-color: #bfdbfe;
      background: #eff6ff;
    }

    .job-id-badge {
      font-size: 0.7rem;
      font-family: monospace;
      background: #dbeafe;
      color: #1e40af;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }

    /* Stepper de etapas */
    .stage-stepper {
      display: flex;
      align-items: flex-start;
      gap: 0;
      margin-bottom: 1.25rem;
      overflow-x: auto;
    }

    .stage-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-width: 60px;
      position: relative;
    }

    .stage-step:not(:last-child)::after {
      content: '';
      position: absolute;
      left: calc(50% + 10px);
      right: calc(-50% + 10px);
      top: 10px;
      height: 2px;
      background: #d1d5db;
      z-index: 0;
    }

    .stage-step.step-done:not(:last-child)::after {
      background: #3b82f6;
    }

    .step-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #d1d5db;
      border: 2px solid #9ca3af;
      z-index: 1;
      transition:
        background 0.3s,
        border-color 0.3s;
    }

    .stage-step.step-done .step-dot {
      background: #3b82f6;
      border-color: #1d4ed8;
    }

    .stage-step.step-active .step-dot {
      background: #fff;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
    }

    .step-label {
      font-size: 0.68rem;
      color: #9ca3af;
      margin-top: 0.35rem;
      text-align: center;
      line-height: 1.2;
    }

    .stage-step.step-done .step-label,
    .stage-step.step-active .step-label {
      color: #1e40af;
      font-weight: 600;
    }

    /* Barra de progreso */
    .progress-bar-container {
      height: 10px;
      background: #dbeafe;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 0.4rem;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #2563eb);
      border-radius: 999px;
      transition: width 0.4s ease;
    }

    .progress-pct {
      font-size: 0.85rem;
      font-weight: 700;
      color: #1e40af;
      margin-bottom: 0.5rem;
    }

    .progress-message {
      font-size: 0.9rem;
      color: #374151;
      font-style: italic;
    }

    /* ── Sección de resultado ── */
    .result-section {
      border-color: #bbf7d0;
      background: #f0fdf4;
    }

    .result-value {
      font-size: 2.5rem;
      font-weight: 800;
      color: #15803d;
      text-align: center;
      margin: 0.5rem 0 1.5rem;
      word-break: break-all;
    }

    .result-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .meta-item {
      background: #fff;
      border: 1px solid #d1fae5;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
    }

    .meta-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.2rem;
    }

    .meta-value {
      font-size: 0.95rem;
      color: #111827;
      font-weight: 500;
    }

    .meta-value.mono {
      font-family: monospace;
      font-size: 0.75rem;
    }
    .meta-value.badge-status {
      background: #dcfce7;
      color: #15803d;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }

    /* ── Sección de error ── */
    .error-section {
      border-color: #fecaca;
      background: #fef2f2;
    }
    .error-title {
      color: #dc2626;
    }
    .error-message {
      color: #b91c1c;
      font-size: 0.95rem;
    }
  `,
})
export class CalculatorComponent implements OnInit, OnDestroy {
  private readonly workflowService = inject(CalculatorWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  readonly operations = this.workflowService.operations;
  readonly stageSteps = this.workflowService.stageSteps;
  readonly selectedOperation = this.workflowService.selectedOperation;
  readonly firstOperand = this.workflowService.firstOperand;
  readonly secondOperand = this.workflowService.secondOperand;
  readonly activeSection = this.workflowService.activeSection;
  readonly currentJobId = this.workflowService.currentJobId;
  readonly progressSnapshot = this.workflowService.progressSnapshot;
  readonly lastResult = this.workflowService.lastResult;
  readonly errorMessage = this.workflowService.errorMessage;
  readonly requiresSecondOperand = this.workflowService.requiresSecondOperand;
  readonly isProcessing = this.workflowService.isProcessing;
  readonly progressPercentage = this.workflowService.progressPercentage;
  readonly progressMessage = this.workflowService.progressMessage;
  readonly currentStage = this.workflowService.currentStage;

  ngOnInit(): void {
    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflowService.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  stageLabel(stageName: string): string {
    return this.workflowService.stageLabel(stageName);
  }

  isStepDone(stepName: string): boolean {
    return this.workflowService.isStepDone(stepName);
  }

  isStepActive(stepName: string): boolean {
    return this.workflowService.isStepActive(stepName);
  }

  dispatch(): void {
    this.workflowService.dispatch();
  }

  reset(): void {
    this.workflowService.reset();
  }
}

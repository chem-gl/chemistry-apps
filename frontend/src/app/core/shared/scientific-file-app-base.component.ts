// scientific-file-app-base.component.ts: Clase base abstracta para componentes Angular de apps
// científicas que gestionan archivos (Easy-rate, Marcus). Centraliza los métodos de ciclo de
// vida (ngOnInit/ngOnDestroy), dispatch, reset, clearFiles y openHistoricalJob que se duplicaban.

import { Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  HistoricalJobWorkflowPort,
  subscribeToRouteHistoricalJob,
} from './scientific-app-ui.utils';

/** Contrato mínimo que deben satisfacer los workflow services de apps con archivos. */
export interface ScientificFileAppWorkflowPort extends HistoricalJobWorkflowPort {
  dispatch(): void;
  reset(): void;
  clearFiles(): void;
}

/**
 * Clase base abstracta para componentes de apps científicas con archivos.
 *
 * Centraliza los 23 líneas duplicadas entre EasyRateComponent y MarcusComponent:
 * ngOnInit, ngOnDestroy, dispatch, reset, clearFiles y openHistoricalJob.
 *
 * Uso:
 * 1. Extender esta clase en el componente concreto.
 * 2. Inyectar el workflow con `override readonly workflow = inject(MyWorkflowService)`.
 * 3. La subclase puede declarar `workflow` como público para acceso desde la plantilla.
 */
@Directive()
export abstract class ScientificFileAppBaseComponent implements OnInit, OnDestroy {
  protected abstract readonly workflow: ScientificFileAppWorkflowPort;

  protected readonly route = inject(ActivatedRoute);
  protected routeSubscription: Subscription | null = null;

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflow);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  clearFiles(): void {
    this.workflow.clearFiles();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }
}

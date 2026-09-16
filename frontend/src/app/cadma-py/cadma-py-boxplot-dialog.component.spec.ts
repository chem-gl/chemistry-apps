import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsApiService } from '../core/api/jobs-api.service';
import { CadmaPyBoxplotDialogComponent } from './cadma-py-boxplot-dialog.component';

const row = { name: 'Ethanol', smiles: 'CCO', selection_score: 1, adme_alignment: 1, toxicity_alignment: 1, sa_alignment: 1, adme_hits_in_band: 1, MW: 46, logP: 0.3, MR: 12, AtX: 3, HBLA: 1, HBLD: 1, RB: 0, PSA: 20, DT: 0.1, M: 0.2, LD50: 300, SA: 2, metrics_in_band: [], best_fit_summary: '' };

describe('CadmaPyBoxplotDialogComponent', () => {
  const jobs = { inspectSmileitStructure: vi.fn(() => of({ svg: '<svg />' })) };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [CadmaPyBoxplotDialogComponent] });
    TestBed.overrideComponent(CadmaPyBoxplotDialogComponent, { set: { template: '', providers: [{ provide: JobsApiService, useValue: jobs }] } });
  });

  function create() {
    const fixture = TestBed.createComponent(CadmaPyBoxplotDialogComponent);
    fixture.componentRef.setInput('ranking', [row]);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('computes metric groups and toggles visibility without hiding the last group', () => {
    const component = create();
    expect(component.allMetrics().length).toBe(12);
    expect(component.visibleMetricsForGroup('ADME').length).toBeGreaterThan(0);
    component.toggleGroup('ADME');
    component.toggleGroup('Toxicity');
    component.toggleGroup('SA Score');
    expect(component.visibleGroups().size).toBe(1);
    component.toggleMetric('MW');
    expect(component.isMetricHidden('MW')).toBe(true);
    component.toggleMetric('MW');
    expect(component.isMetricHidden('MW')).toBe(false);
  });

  it('selects a compound, loads SVG and handles inspection errors', () => {
    const component = create();
    component.onChartClick({ seriesType: 'bar', data: { smiles: 'CCO' } });
    expect(component.selectedCompound()).toBeNull();
    component.onChartClick({ seriesType: 'scatter', data: { smiles: 'CCO' } });
    expect(component.selectedCompound()?.name).toBe('Ethanol');
    expect(component.compoundSvg()).not.toBeNull();
    jobs.inspectSmileitStructure.mockReturnValueOnce(throwError(() => new Error('down')));
    component.selectCompound(row);
    expect(component.compoundError()).toContain('Could not generate');
    expect(component.compoundBusy()).toBe(false);
  });

  it('formats values, clears selection and closes a dialog', () => {
    const component = create();
    expect(component.formatMetricLabel('MW')).toBe('Molecular Weight');
    expect(component.formatMetricLabel('unknown')).toBe('unknown');
    expect(component.formatValue(null)).toBe('—');
    expect(component.formatValue(1.234)).toBe('1.23');
    component.selectCompound(row);
    component.clearSelectedCompound();
    expect(component.compoundMetrics()).toEqual([]);
    const close = vi.fn();
    (component as unknown as { dialogRef: { nativeElement: HTMLDialogElement } }).dialogRef = { nativeElement: { close } as unknown as HTMLDialogElement };
    component.close();
    expect(close).toHaveBeenCalled();
  });

  it('opens, initializes the chart and closes on a backdrop click', () => {
    const component = create();
    const showModal = vi.fn();
    const close = vi.fn();
    (component as unknown as { dialogRef: { nativeElement: HTMLDialogElement } }).dialogRef = {
      nativeElement: {
        showModal,
        close,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      } as unknown as HTMLDialogElement,
    };
    const chart = { resize: vi.fn() };
    component.onChartInit(chart as unknown as Parameters<typeof component.onChartInit>[0]);
    component.open();
    expect(showModal).toHaveBeenCalledOnce();

    component.onBackdropClick(new MouseEvent('click', { clientX: 0, clientY: 0 }));
    expect(close).not.toHaveBeenCalled();
    component.onBackdropClick(new MouseEvent('click', { clientX: -1, clientY: -1 }));
    expect(close).toHaveBeenCalledOnce();
    expect(component.selectedCompound()).toBeNull();
  });

  it('ignores chart points without a matching scatter compound and exposes empty metrics', () => {
    const component = create();
    component.onChartClick({ seriesType: 'line', data: { smiles: 'CCO' } });
    component.onChartClick({ seriesType: 'scatter', data: {} });
    component.onChartClick({ seriesType: 'scatter', data: { smiles: 'missing' } });
    expect(component.selectedCompound()).toBeNull();
    expect(component.compoundMetrics()).toEqual([]);
    expect(component.formatValue(undefined as unknown as number)).toBe('—');
  });
});

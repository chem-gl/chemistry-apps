// principal-svg-viewer.component.spec.ts: Pruebas unitarias del visor SVG principal con zoom y eventos de click.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrincipalSvgViewerComponent } from './principal-svg-viewer.component';

describe('PrincipalSvgViewerComponent', () => {
  let component: PrincipalSvgViewerComponent;
  let fixture: ComponentFixture<PrincipalSvgViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrincipalSvgViewerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PrincipalSvgViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should emit inspectionSvgClicked when svg stage is clicked and not processing', () => {
    const emitSpy = vi.spyOn(component.inspectionSvgClicked, 'emit');
    const svgStage: HTMLDivElement = fixture.debugElement.query(
      By.css('.principal-svg-stage'),
    ).nativeElement;

    svgStage.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('should not emit inspectionSvgClicked while processing', () => {
    component.isProcessing = true;
    fixture.detectChanges();

    const emitSpy = vi.spyOn(component.inspectionSvgClicked, 'emit');
    const svgStage: HTMLDivElement = fixture.debugElement.query(
      By.css('.principal-svg-stage'),
    ).nativeElement;

    svgStage.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should respect zoom bounds', () => {
    component.zoomLevel = component.maxZoomLevel;

    component.zoomIn();

    expect(component.zoomLevel).toBe(component.maxZoomLevel);

    component.zoomLevel = component.minZoomLevel;

    component.zoomOut();

    expect(component.zoomLevel).toBe(component.minZoomLevel);
  });

  it('canvasSizePx reflects baseCanvasPx multiplied by current zoom level', () => {
    component.zoomLevel = 2;
    expect(component.canvasSizePx).toBe(component.baseCanvasPx * 2);
  });

  it('zoomIn increments zoom level when not at max', () => {
    component.zoomLevel = 1;
    component.zoomIn();
    expect(component.zoomLevel).toBe(2);
  });

  it('zoomOut decrements zoom level when not at min', () => {
    component.zoomLevel = 2;
    component.zoomOut();
    expect(component.zoomLevel).toBe(1);
  });

  it('onInspectionSvgClick ignores keyboard events', () => {
    const emitSpy = vi.spyOn(component.inspectionSvgClicked, 'emit');
    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter' });

    component.onInspectionSvgClick(keyEvent);

    expect(emitSpy).not.toHaveBeenCalled();
  });
});

// principal-molecule-editor.component.spec.ts: Pruebas unitarias del editor textual de molécula principal.

import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrincipalMoleculeEditorComponent } from './principal-molecule-editor.component';

describe('PrincipalMoleculeEditorComponent', () => {
  let component: PrincipalMoleculeEditorComponent;
  let fixture: ComponentFixture<PrincipalMoleculeEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, PrincipalMoleculeEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PrincipalMoleculeEditorComponent);
    component = fixture.componentInstance;
    component.principalSmiles = 'CCO';
    fixture.detectChanges();
  });

  it('should emit principalSmilesChange when input changes', () => {
    const emitSpy = vi.spyOn(component.principalSmilesChange, 'emit');
    const inputElement: HTMLInputElement = fixture.debugElement.query(
      By.css('input'),
    ).nativeElement;

    inputElement.value = 'c1ccccc1';
    inputElement.dispatchEvent(new Event('input'));

    expect(emitSpy).toHaveBeenCalledWith('c1ccccc1');
  });

  it('should emit inspectRequested when inspect button is clicked', () => {
    const emitSpy = vi.spyOn(component.inspectRequested, 'emit');
    const actionButtons: HTMLButtonElement[] = fixture.debugElement
      .queryAll(By.css('.principal-actions-row button'))
      .map((debugElement) => debugElement.nativeElement as HTMLButtonElement);
    const inspectButton: HTMLButtonElement = actionButtons[1];

    inspectButton.click();

    expect(emitSpy).toHaveBeenCalled();
  });

  it('should open sketch modifier modal when sketch button is clicked', () => {
    const actionButtons: HTMLButtonElement[] = fixture.debugElement
      .queryAll(By.css('.principal-actions-row button'))
      .map((debugElement) => debugElement.nativeElement as HTMLButtonElement);
    const openSketchButton: HTMLButtonElement = actionButtons[0];

    openSketchButton.click();
    fixture.detectChanges();

    const dialogElement: HTMLDialogElement = fixture.debugElement.query(
      By.css('.sketch-modifier-dialog'),
    ).nativeElement;
    expect(dialogElement.hasAttribute('open')).toBe(true);

    const ketcherFrameElement: HTMLIFrameElement | null = fixture.debugElement.query(
      By.css('.ketcher-frame'),
    )?.nativeElement;
    expect(ketcherFrameElement).not.toBeNull();
  });

  it('openSketchModifier uses an existing dialog reference when available', () => {
    component.isKetcherReady = true;
    const dialogElement = {
      open: false,
      showModal: vi.fn(),
      close: vi.fn(),
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as HTMLDialogElement;

    (
      component as unknown as { sketchModifierDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchModifierDialogRef = {
      nativeElement: dialogElement,
    };

    component.openSketchModifier();

    expect(dialogElement.showModal).toHaveBeenCalledOnce();
  });

  it('closeSketchModifier closes an open dialog and clears validation state', () => {
    const dialogElement = {
      open: true,
      close: vi.fn(),
      removeAttribute: vi.fn(),
    } as unknown as HTMLDialogElement;

    (
      component as unknown as { sketchModifierDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchModifierDialogRef = {
      nativeElement: dialogElement,
    };

    component.closeSketchModifier();

    expect(dialogElement.close).toHaveBeenCalledOnce();
    expect(component.sketchValidationError()).toBeNull();
  });

  it('should emit principalSmilesChange when applying a valid sketch modifier', async () => {
    const emitSpy = vi.spyOn(component.principalSmilesChange, 'emit');

    // Simular que Ketcher no está disponible; el draft se toma de sketchDraftSmiles directamente.
    component.sketchDraftSmiles = 'c1ncccc1';
    fixture.detectChanges();

    await component.applySketchModifier();

    expect(emitSpy).toHaveBeenCalledWith('c1ncccc1');
  });

  it('should also emit inspectRequested when applying a valid sketch', async () => {
    const inspectSpy = vi.spyOn(component.inspectRequested, 'emit');
    component.sketchDraftSmiles = 'c1ccccc1';
    fixture.detectChanges();

    await component.applySketchModifier();

    expect(inspectSpy).toHaveBeenCalled();
  });

  it('should set sketchValidationError when SMILES is empty and not emit changes', async () => {
    const emitSpy = vi.spyOn(component.principalSmilesChange, 'emit');
    const inspectSpy = vi.spyOn(component.inspectRequested, 'emit');
    component.sketchDraftSmiles = '';
    fixture.detectChanges();

    await component.applySketchModifier();

    expect(component.sketchValidationError()).not.toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it('should set sketchValidationError when SMILES has multiple fragments and not emit changes', async () => {
    const emitSpy = vi.spyOn(component.principalSmilesChange, 'emit');
    const inspectSpy = vi.spyOn(component.inspectRequested, 'emit');
    // SMILES con "." indica múltiples moléculas/fragmentos.
    component.sketchDraftSmiles = 'CCO.c1ccccc1';
    fixture.detectChanges();

    await component.applySketchModifier();

    expect(component.sketchValidationError()).not.toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it('should clear sketchValidationError when closing the sketch modifier', async () => {
    component.sketchDraftSmiles = '';
    await component.applySketchModifier();
    expect(component.sketchValidationError()).not.toBeNull();

    component.closeSketchModifier();

    expect(component.sketchValidationError()).toBeNull();
  });

  it('onSketchModifierDialogClick closes modifier when clicking on the dialog backdrop', () => {
    const closeSpy = vi.spyOn(component, 'closeSketchModifier');
    const dialogElement = {
      open: false,
      close: vi.fn(),
      removeAttribute: vi.fn(),
    } as unknown as HTMLDialogElement;

    (
      component as unknown as { sketchModifierDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchModifierDialogRef = {
      nativeElement: dialogElement,
    };

    // Simula un click cuyo target es el propio diálogo (click fuera del contenido)
    const event = new MouseEvent('click');
    Object.defineProperty(event, 'target', { value: dialogElement });
    component.onSketchModifierDialogClick(event);

    expect(closeSpy).toHaveBeenCalled();
  });

  it('onSketchModifierDialogClick does not close when clicking inside the dialog content', () => {
    const closeSpy = vi.spyOn(component, 'closeSketchModifier');
    const dialogElement = {} as HTMLDialogElement;
    const innerElement = {} as HTMLElement;

    (
      component as unknown as { sketchModifierDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchModifierDialogRef = {
      nativeElement: dialogElement,
    };

    const event = new MouseEvent('click');
    Object.defineProperty(event, 'target', { value: innerElement });
    component.onSketchModifierDialogClick(event);

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('onKetcherFrameLoaded marks isKetcherReady as true', () => {
    expect(component.isKetcherReady).toBe(false);

    component.onKetcherFrameLoaded();

    expect(component.isKetcherReady).toBe(true);
    expect(component.isSketchModifierLoading()).toBe(false);
  });
});

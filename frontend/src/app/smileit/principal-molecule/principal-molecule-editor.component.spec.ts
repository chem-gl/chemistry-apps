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

  it('should emit principalSmilesChange when applying sketch modifier', async () => {
    const emitSpy = vi.spyOn(component.principalSmilesChange, 'emit');
    const actionButtons: HTMLButtonElement[] = fixture.debugElement
      .queryAll(By.css('.principal-actions-row button'))
      .map((debugElement) => debugElement.nativeElement as HTMLButtonElement);
    const openSketchButton: HTMLButtonElement = actionButtons[0];

    openSketchButton.click();
    fixture.detectChanges();

    const textareaElement: HTMLTextAreaElement = fixture.debugElement.query(
      By.css('textarea'),
    ).nativeElement;
    textareaElement.value = 'c1ncccc1';
    textareaElement.dispatchEvent(new Event('input'));

    const modalButtons: HTMLButtonElement[] = fixture.debugElement
      .queryAll(By.css('.sketch-modifier-actions button'))
      .map((debugElement) => debugElement.nativeElement as HTMLButtonElement);
    const applyButton: HTMLButtonElement = modalButtons[1];

    applyButton.click();
    await fixture.whenStable();

    expect(emitSpy).toHaveBeenCalledWith('c1ncccc1');
  });
});

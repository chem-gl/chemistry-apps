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
    const inspectButton: HTMLButtonElement = fixture.debugElement.query(
      By.css('button'),
    ).nativeElement;

    inspectButton.click();

    expect(emitSpy).toHaveBeenCalled();
  });
});

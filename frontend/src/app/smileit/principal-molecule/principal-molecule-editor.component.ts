// principal-molecule-editor.component.ts: Editor textual de molécula principal con acción de inspección para Smile-it.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-principal-molecule-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './principal-molecule-editor.component.html',
  styleUrl: './principal-molecule-editor.component.scss',
})
export class PrincipalMoleculeEditorComponent {
  @Input() principalSmiles: string = '';
  @Input() isProcessing: boolean = false;
  @Input() isInspecting: boolean = false;

  @Output() readonly principalSmilesChange = new EventEmitter<string>();
  @Output() readonly inspectRequested = new EventEmitter<void>();

  onPrincipalSmilesChange(nextPrincipalSmiles: string): void {
    this.principalSmilesChange.emit(nextPrincipalSmiles);
  }

  requestInspect(): void {
    this.inspectRequested.emit();
  }
}

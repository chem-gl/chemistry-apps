// smiles-batch-input.component.ts: Campo de texto batch para ingresar SMILES con soporte
// para sketch Ketcher y carga de archivo .smi/.txt. Se reutiliza en sa-score y toxicity-properties.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NamedSmilesInputRow } from '../../scientific-app-ui.utils';

@Component({
  selector: 'app-smiles-batch-input',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './smiles-batch-input.component.html',
  styleUrl: './smiles-batch-input.component.scss',
})
export class SmilesBatchInputComponent {
  /** Valor actual del textarea de SMILES. */
  @Input() smilesValue: string = '';

  /** Indica si los controles de entrada están deshabilitados (mientras se procesa). */
  @Input() isDisabled: boolean = false;

  /** Número de filas SMILES detectadas (sin blancos). */
  @Input() lineCount: number = 0;

  /** Filas parseadas del lote para edición opcional de nombres personalizados. */
  @Input() inputRows: NamedSmilesInputRow[] = [];

  /** Indica si la tabla de nombres personalizados debe estar visible. */
  @Input() customNamesEnabled: boolean = false;

  /** Emitido cuando el usuario edita el textarea; lleva el nuevo valor completo. */
  @Output() smilesChange = new EventEmitter<string>();

  /** Emitido al activar o desactivar la edición de nombres personalizados. */
  @Output() customNamesEnabledChange = new EventEmitter<boolean>();

  /** Emitido al editar el nombre de una fila concreta. */
  @Output() rowNameChange = new EventEmitter<{ index: number; name: string }>();

  /** Emitido al pulsar el botón "Draw SMILES". */
  @Output() openSketch = new EventEmitter<void>();

  /** Emitido al seleccionar un archivo; lleva el Event nativo del input[file]. */
  @Output() fileUpload = new EventEmitter<Event>();
}

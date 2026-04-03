// diffusion-fields.component.ts: Componente reutilizable para los campos de difusión (radios y distancia de reacción).
// Usado por Easy-rate y Marcus para evitar duplicación de HTML en los formularios de parámetros.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-diffusion-fields',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './diffusion-fields.component.html',
  styleUrl: './diffusion-fields.component.scss',
})
export class DiffusionFieldsComponent {
  @Input() showDiffusionFields: boolean = false;
  @Input() radiusReactant1: number | null = null;
  @Input() radiusReactant2: number | null = null;
  @Input() reactionDistance: number | null = null;
  @Input() isProcessing: boolean = false;

  @Output() radiusReactant1Change = new EventEmitter<number>();
  @Output() radiusReactant2Change = new EventEmitter<number>();
  @Output() reactionDistanceChange = new EventEmitter<number>();
}

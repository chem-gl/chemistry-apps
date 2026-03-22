// principal-molecule-editor.module.ts: Módulo de presentación para exponer el editor de molécula principal en Smile-it.

import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PrincipalMoleculeEditorComponent } from './principal-molecule-editor.component';

@NgModule({
  imports: [CommonModule, FormsModule, PrincipalMoleculeEditorComponent],
  exports: [PrincipalMoleculeEditorComponent],
})
export class PrincipalMoleculeEditorModule {}

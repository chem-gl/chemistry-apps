// principal-svg-viewer.module.ts: Módulo de presentación para exponer el visor SVG principal reutilizable.

import { NgModule } from '@angular/core';

import { PrincipalSvgViewerComponent } from './principal-svg-viewer.component';

@NgModule({
  imports: [PrincipalSvgViewerComponent],
  exports: [PrincipalSvgViewerComponent],
})
export class PrincipalSvgViewerModule {}

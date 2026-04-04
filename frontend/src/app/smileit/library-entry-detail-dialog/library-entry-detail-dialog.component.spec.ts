// library-entry-detail-dialog.component.spec.ts: Pruebas unitarias del dialog de detalle de entradas de librería Smile-it.
// Cubre: zoom/pan, cierre del dialog, delegación a resolvers, y comportamiento de estado interno.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SafeHtml } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmileitCatalogEntryView } from '../../core/api/jobs-api.service';
import { LibraryEntryDetailDialogComponent } from './library-entry-detail-dialog.component';

const buildMockEntry = (id: number = 1): SmileitCatalogEntryView =>
  ({
    id,
    label: `Entry ${id}`,
    smiles: 'CCO',
    group_key: 'default',
    svg_preview: '<svg></svg>',
    is_editable: true,
    is_referenced: false,
  }) as unknown as SmileitCatalogEntryView;

describe('LibraryEntryDetailDialogComponent', () => {
  let component: LibraryEntryDetailDialogComponent;
  let fixture: ComponentFixture<LibraryEntryDetailDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LibraryEntryDetailDialogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LibraryEntryDetailDialogComponent);
    component = fixture.componentInstance;

    // Configurar inputs requeridos con valores mínimos
    fixture.componentRef.setInput('previewSvgResolver', () => null);
    fixture.componentRef.setInput('isReferencedInAnyBlockResolver', () => false);
    fixture.componentRef.setInput('isCatalogEntryEditableResolver', () => true);
    fixture.detectChanges();
  });

  describe('estado inicial de zoom y pan', () => {
    it('comienza con zoom level 1', () => {
      expect(component.libraryDetailZoomLevel()).toBe(1);
    });

    it('comienza sin desplazamiento pan', () => {
      expect(component.libraryDetailPanX()).toBe(0);
      expect(component.libraryDetailPanY()).toBe(0);
    });

    it('previewSize computed a 380 en zoom 1', () => {
      expect(component.libraryDetailPreviewSize()).toBe(380);
    });
  });

  describe('zoomInLibraryDetail y zoomOutLibraryDetail', () => {
    it('aumenta el zoom level en 1 al hacer zoom in', () => {
      component.zoomInLibraryDetail();
      expect(component.libraryDetailZoomLevel()).toBe(2);
    });

    it('no supera el zoom máximo de 4', () => {
      for (let i = 0; i < 10; i++) {
        component.zoomInLibraryDetail();
      }
      expect(component.libraryDetailZoomLevel()).toBe(4);
    });

    it('reduce el zoom level en 1 al hacer zoom out', () => {
      component.zoomInLibraryDetail();
      component.zoomOutLibraryDetail();
      expect(component.libraryDetailZoomLevel()).toBe(1);
    });

    it('no baja del zoom mínimo de 1', () => {
      for (let i = 0; i < 5; i++) {
        component.zoomOutLibraryDetail();
      }
      expect(component.libraryDetailZoomLevel()).toBe(1);
    });

    it('resetea pan al hacer zoom in', () => {
      component.libraryDetailPanX.set(50);
      component.libraryDetailPanY.set(50);
      component.zoomInLibraryDetail();
      expect(component.libraryDetailPanX()).toBe(0);
      expect(component.libraryDetailPanY()).toBe(0);
    });

    it('resetea pan al hacer zoom out', () => {
      component.zoomInLibraryDetail();
      component.libraryDetailPanX.set(30);
      component.zoomOutLibraryDetail();
      expect(component.libraryDetailPanX()).toBe(0);
    });
  });

  describe('pan interactivo con mouse', () => {
    it('activa dragging al iniciar pan', () => {
      const mouseEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
      component.onLibraryDetailPanStart(mouseEvent);
      expect(component.libraryDetailIsDragging()).toBe(true);
    });

    it('actualiza pan durante el movimiento si está arrastrando', () => {
      // Primero: zoom in para que haya overflow disponible
      component.zoomInLibraryDetail();

      const startEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
      component.onLibraryDetailPanStart(startEvent);

      const moveEvent = new MouseEvent('mousemove', { clientX: 120, clientY: 140 });
      component.onLibraryDetailPanMove(moveEvent);

      // Con desplazamiento de 20px/40px y previewSize 480 y viewport 280,
      // halfOverflow = (480-280)/2 = 100, así que los valores no se clampean.
      expect(component.libraryDetailPanX()).toBe(20);
      expect(component.libraryDetailPanY()).toBe(40);
    });

    it('no mueve el pan si isDragging es false', () => {
      const moveEvent = new MouseEvent('mousemove', { clientX: 50, clientY: 50 });
      component.onLibraryDetailPanMove(moveEvent);
      expect(component.libraryDetailPanX()).toBe(0);
      expect(component.libraryDetailPanY()).toBe(0);
    });

    it('desactiva dragging al soltar', () => {
      const startEvent = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
      component.onLibraryDetailPanStart(startEvent);
      component.onLibraryDetailPanEnd();
      expect(component.libraryDetailIsDragging()).toBe(false);
    });
  });

  describe('zoom con rueda del mouse', () => {
    it('desplaza el pan según el delta del evento wheel', () => {
      component.zoomInLibraryDetail(); // habilitar overflow
      const wheelEvent = new WheelEvent('wheel', { deltaX: 10, deltaY: 20 });
      vi.spyOn(wheelEvent, 'stopPropagation');
      component.onLibraryDetailWheel(wheelEvent);
      // rawX = 0 - 10*0.6 = -6, rawY = 0 - 20*0.6 = -12
      expect(component.libraryDetailPanX()).toBeCloseTo(-6);
      expect(component.libraryDetailPanY()).toBeCloseTo(-12);
    });
  });

  describe('events emitidos', () => {
    it('emite closeRequested al llamar requestClose', () => {
      const emitSpy = vi.spyOn(component.closeRequested, 'emit');
      component.requestClose();
      expect(emitSpy).toHaveBeenCalled();
    });

    it('emite editRequested con la entrada al llamar requestEdit', () => {
      const emitSpy = vi.spyOn(component.editRequested, 'emit');
      const entry = buildMockEntry();
      component.requestEdit(entry);
      expect(emitSpy).toHaveBeenCalledWith(entry);
    });
  });

  describe('delegación a resolvers de entrada', () => {
    it('llama al previewSvgResolver con la entrada dada', () => {
      const mockSvg = '<svg>preview</svg>' as unknown as SafeHtml;
      const resolver = vi.fn().mockReturnValue(mockSvg);
      fixture.componentRef.setInput('previewSvgResolver', resolver);
      fixture.detectChanges();

      const entry = buildMockEntry();
      const result = component.resolvedEntrySvg(entry);
      expect(result).toBe(mockSvg);
    });

    it('isEntryAdded retorna true cuando el contexto es reference', () => {
      fixture.componentRef.setInput('openContext', 'reference');
      fixture.componentRef.setInput('isReferencedInAnyBlockResolver', () => () => false);
      fixture.detectChanges();
      const entry = buildMockEntry();
      expect(component.isEntryAdded(entry)).toBe(true);
    });

    it('isEntryAdded delega al resolver cuando el contexto es browser', () => {
      const resolver = vi.fn().mockReturnValue(true);
      fixture.componentRef.setInput('openContext', 'browser');
      fixture.componentRef.setInput('isReferencedInAnyBlockResolver', resolver);
      fixture.detectChanges();
      const entry = buildMockEntry();
      expect(component.isEntryAdded(entry)).toBe(true);
      expect(resolver).toHaveBeenCalledWith(entry);
    });

    it('isEntryEditable delega al resolver', () => {
      const resolver = vi.fn().mockReturnValue(false);
      fixture.componentRef.setInput('isCatalogEntryEditableResolver', resolver);
      fixture.detectChanges();
      const entry = buildMockEntry();
      expect(component.isEntryEditable(entry)).toBe(false);
    });
  });
});

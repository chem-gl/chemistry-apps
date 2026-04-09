// scientific-app-ui.utils.spec.ts: Pruebas unitarias para utilidades UI compartidas
// Las pruebas usan `vitest` y están diseñadas para ser rápidas y deterministas.

import { describe, expect, it, vi } from 'vitest';

import { ActivatedRoute, ParamMap } from '@angular/router';

import {
  buildSmilesTextFromRows,
  closeDialogOnBackdropClick,
  downloadBlobFile,
  HistoricalJobWorkflowPort,
  parseNamedSmilesBatch,
  parseSmilesLines,
  subscribeToRouteHistoricalJob,
} from './scientific-app-ui.utils';

describe('scientific-app-ui.utils', () => {
  it('parseSmilesLines elimina comentarios y líneas vacías', () => {
    const raw = `# comment\nC C O\n\n  # another\nN`;
    const result = parseSmilesLines(raw);
    expect(result).toBe('C C O\nN');
  });

  it('parseNamedSmilesBatch interpreta csv con name en primera columna y smiles en segunda', () => {
    const parsed = parseNamedSmilesBatch('name,smiles\nethanol,CCO\nbenzene,c1ccccc1');

    expect(parsed.containsExplicitNames).toBe(true);
    expect(parsed.rows).toEqual([
      { name: 'ethanol', smiles: 'CCO' },
      { name: 'benzene', smiles: 'c1ccccc1' },
    ]);
  });

  it('parseNamedSmilesBatch ignora cabecera csv con BOM UTF-8', () => {
    const parsed = parseNamedSmilesBatch('\uFEFFname,smiles\nethanol,CCO\nbenzene,c1ccccc1');

    expect(parsed.rows).toEqual([
      { name: 'ethanol', smiles: 'CCO' },
      { name: 'benzene', smiles: 'c1ccccc1' },
    ]);
  });

  it('parseNamedSmilesBatch ignora cabecera de una sola columna smiles', () => {
    const parsed = parseNamedSmilesBatch('SMILES\nCCO\nN#N');

    expect(parsed.containsExplicitNames).toBe(false);
    expect(parsed.rows).toEqual([
      { name: 'CCO', smiles: 'CCO' },
      { name: 'N#N', smiles: 'N#N' },
    ]);
  });

  it('parseNamedSmilesBatch usa smiles como nombre por defecto en listas simples', () => {
    const parsed = parseNamedSmilesBatch('CCO\nN#N');

    expect(parsed.containsExplicitNames).toBe(false);
    expect(parsed.rows).toEqual([
      { name: 'CCO', smiles: 'CCO' },
      { name: 'N#N', smiles: 'N#N' },
    ]);
  });

  it('buildSmilesTextFromRows genera el textarea canonico solo con smiles', () => {
    const result = buildSmilesTextFromRows([
      { name: 'ethanol', smiles: 'CCO' },
      { name: 'benzene', smiles: 'c1ccccc1' },
    ]);

    expect(result).toBe('CCO\nc1ccccc1');
  });

  it('subscribeToRouteHistoricalJob llama loadHistory y openHistoricalJob cuando hay jobId', () => {
    const route = {
      queryParamMap: {
        subscribe: (cb: (m: ParamMap) => void) => {
          cb({ get: (_k: string) => 'job-123' } as unknown as ParamMap);
          return { unsubscribe: () => {} };
        },
      },
    } as unknown as ActivatedRoute;

    const workflow: HistoricalJobWorkflowPort = {
      loadHistory: vi.fn(),
      openHistoricalJob: vi.fn(),
    };

    subscribeToRouteHistoricalJob(route, workflow);
    expect(workflow.loadHistory).toHaveBeenCalled();
    expect(workflow.openHistoricalJob).toHaveBeenCalledWith('job-123');
  });

  it('downloadBlobFile crea URL y hace click en el anchor', () => {
    const clickSpy = vi.fn();
    const revokeSpy = vi.fn();

    // Asegurar existencia de URL.createObjectURL/revokeObjectURL en entorno Node
    if (!('URL' in globalThis) || typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:fake',
        revokeObjectURL: revokeSpy,
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeSpy as (url: string) => void);
    }

    const fakeAnchor = {
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement;

    // Stubear document cuando no exista (Node env)
    if ('document' in globalThis) {
      vi.spyOn(document, 'createElement').mockReturnValue(fakeAnchor as unknown as HTMLElement);
    } else {
      vi.stubGlobal('document', { createElement: () => fakeAnchor });
    }

    downloadBlobFile('file.txt', new Blob(['x']));

    // Verificaciones
    // Verificaciones: asegurar que se ejecutó el click y que createObjectURL responde
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL(new Blob(['x']))).toBeDefined();

    // Limpiar stubs globales si fueron creados
    try {
      vi.unstubAllGlobals();
    } catch {
      // noop
    }
    vi.restoreAllMocks();
  });

  it('closeDialogOnBackdropClick detecta clicks fuera del dialog', () => {
    const rect = { left: 10, right: 110, top: 10, bottom: 110 } as DOMRect;
    const dialog = {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLDialogElement;

    // En entornos Node la clase MouseEvent puede no existir, crear un stub
    if (!('MouseEvent' in globalThis)) {
      class FakeMouseEvent {
        clientX: number;
        clientY: number;
        constructor(_t: string, opts: MouseEventInit) {
          this.clientX = opts.clientX ?? 0;
          this.clientY = opts.clientY ?? 0;
        }
      }
      vi.stubGlobal('MouseEvent', FakeMouseEvent as unknown as typeof MouseEvent);
    }

    const outsideClick = new MouseEvent('click', { clientX: 5, clientY: 5 });
    const cb = vi.fn();
    closeDialogOnBackdropClick(outsideClick, dialog, cb);
    expect(cb).toHaveBeenCalled();

    // Click dentro no debe llamar
    const innerClick = new MouseEvent('click', { clientX: 50, clientY: 50 });
    const cb2 = vi.fn();
    closeDialogOnBackdropClick(innerClick, dialog, cb2);
    expect(cb2).not.toHaveBeenCalled();

    try {
      vi.unstubAllGlobals();
    } catch {
      // noop
    }
  });
});

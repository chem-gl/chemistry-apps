// cadma-py-importer.component.spec.ts: Pruebas del importador guiado de CADMA Py.

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyImporterComponent } from './cadma-py-importer.component';

describe('CadmaPyImporterComponent', () => {
  const translocoMock = {
    translate: vi.fn((key: string) => key),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [CadmaPyImporterComponent] });
    TestBed.overrideComponent(CadmaPyImporterComponent, {
      set: {
        template: '',
        providers: [{ provide: TranslocoService, useValue: translocoMock }],
      },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('empieza vacío y muestra el resumen de ausencia de archivos', () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;

    expect(component.sources()).toHaveLength(0);
    expect(component.summaryText()).toBe('No files configured yet.');
    expect(component.uploadButtonTitle()).toBe('Upload one or many CSV / SMI files');
  });

  it('importa un CSV, infiere columnas y emite el estado serializado', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const stateChanged = vi.fn();
    component.stateChanged.subscribe(stateChanged);
    const file = {
      name: 'candidates.csv',
      text: vi.fn(() => Promise.resolve('SMILES,Name,LD50\nCCO,Ethanol,320\n')),
    } as unknown as File;
    const input = { files: [file], value: 'selected' } as unknown as HTMLInputElement;

    await component.onFilesSelected({ target: input } as unknown as Event);

    expect(file.text).toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(component.totalUsableRows()).toBe(1);
    expect(component.sources()[0]?.smilesColumn).toBe('SMILES');
    expect(component.sources()[0]?.nameColumn).toBe('Name');
    expect(stateChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        totalFiles: 1,
        totalUsableRows: 1,
        filenames: ['candidates.csv'],
      }),
    );
    expect(JSON.parse(stateChanged.mock.lastCall?.[0].sourceConfigsJson as string)).toHaveLength(1);
  });

  it('acepta archivos SMI sin cabecera y separa SMILES y nombre', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const file = {
      name: 'candidates.smi',
      text: vi.fn(() => Promise.resolve('CCO ethanol\nc1ccccc1 benzene\n')),
    } as unknown as File;

    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);

    expect(component.sources()[0]?.fileFormat).toBe('smi');
    expect(component.sources()[0]?.previewRows).toEqual([
      ['CCO', 'ethanol'],
      ['c1ccccc1', 'benzene'],
    ]);
    // El componente no infiere todavía column1 como SMILES en archivos SMI sin cabecera.
    expect(component.sources()[0]?.smilesColumn).toBe('');
  });

  it('emite error y configuración vacía cuando los archivos tienen filas desalineadas', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const stateChanged = vi.fn();
    component.stateChanged.subscribe(stateChanged);
    const firstFile = {
      name: 'guide.csv',
      text: vi.fn(() => Promise.resolve('smiles,name\nCCO,one\n')),
    } as unknown as File;
    const secondFile = {
      name: 'toxicity.csv',
      text: vi.fn(() => Promise.resolve('smiles,DT\nCCO,1\nCCN,2\n')),
    } as unknown as File;

    await component.onFilesSelected({
      target: { files: [firstFile, secondFile], value: '' },
    } as unknown as Event);

    expect(component.importerError()).toContain('Row count mismatch');
    expect(stateChanged.mock.lastCall?.[0].sourceConfigsJson).toBe('');
    expect(component.summaryText()).toContain('2 files');
  });

  it('restaura configuraciones válidas y descarta JSON inválido', () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;

    fixture.componentRef.setInput(
      'initialSourceConfigsJson',
      JSON.stringify([
        {
          filename: 'saved.csv',
          content_text: 'smiles,name\nCCO,Ethanol',
          file_format: 'csv',
          has_header: true,
        },
      ]),
    );
    fixture.detectChanges();

    expect(component.sources()).toHaveLength(1);
    expect(component.sources()[0]?.filename).toBe('saved.csv');
    expect(component.sources()[0]?.usableRowCount).toBe(1);

    fixture.componentRef.setInput('initialSourceConfigsJson', '{invalid');
    fixture.detectChanges();
    expect(component.sources()).toHaveLength(1);
  });

  it('cambia el archivo guía y evita columnas SMILES duplicadas', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const files = [
      {
        name: 'guide.csv',
        text: vi.fn(() => Promise.resolve('smiles,name\nCCO,one\n')),
      },
      {
        name: 'extra.csv',
        text: vi.fn(() => Promise.resolve('smiles,DT\nCCO,1\n')),
      },
    ] as unknown as File[];

    await component.onFilesSelected({ target: { files, value: '' } } as unknown as Event);
    const secondId = component.sources()[1]?.id ?? '';
    component.setSmilesGuideFile(secondId);

    expect(component.sources()[0]?.smilesColumn).toBe('');
    expect(component.sources()[1]?.smilesColumn).toBe('smiles');
    expect(component.smilesGuideFileIndex()).toBe(1);
  });

  it('emite un estado inválido cuando se elimina la guía y permite restaurarla', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const stateChanged = vi.fn();
    component.stateChanged.subscribe(stateChanged);
    const file = {
      name: 'guide.csv',
      text: vi.fn(() => Promise.resolve('SMILES,Name\nCCO,Ethanol\n')),
    } as unknown as File;

    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const sourceId = component.sources()[0]?.id ?? '';
    component.assignColumnRole(sourceId, 'SMILES', '');
    expect(component.importerError()).toContain('main SMILES column');
    expect(stateChanged.mock.lastCall?.[0].sourceConfigsJson).toBe('');

    component.assignColumnRole(sourceId, 'SMILES', 'smiles');
    expect(component.importerError()).toBe('');
    expect(component.roleForColumn(component.sources()[0]!, 'SMILES')).toBe('smiles');
  });

  it('reparsea CSV con comentarios, columnas remapeadas y alterna el colapso', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const file = {
      name: 'guide.csv',
      text: vi.fn(() => Promise.resolve('# metadata\nsmiles;compound;doi\nCCO;Ethanol;10.1/x\n')),
    } as unknown as File;

    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const source = component.sources()[0];
    expect(source?.delimiter).toBe(';');
    expect(source?.nameColumn).toBe('compound');
    expect(source?.paperUrlColumn).toBe('doi');
    component.toggleSourceCollapse(source?.id ?? '');
    expect(component.isSourceCollapsed(source?.id ?? '')).toBe(true);
    component.toggleSourceCollapse(source?.id ?? '');
    expect(component.isSourceCollapsed(source?.id ?? '')).toBe(false);

    component.assignColumnRole(source?.id ?? '', 'compound', 'smiles');
    expect(component.roleForColumn(component.sources()[0]!, 'compound')).toBe('smiles');
    component.reparseSource(source?.id ?? '');
    expect(component.sources()[0]?.smilesColumn).toBe('compound');
  });

  it('restaura formatos, campos alternativos y descarta entradas inválidas', () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('initialSourceConfigsJson', JSON.stringify([
      null,
      { contentText: 'CCO ethanol\n', fileName: 'restored.smi', fileFormat: 'smi', hasHeader: false },
      { content_text: '   ' },
    ]));
    fixture.detectChanges();

    expect(component.sources()).toHaveLength(1);
    expect(component.sources()[0]?.fileFormat).toBe('smi');
    expect(component.sources()[0]?.filename).toBe('restored.smi');
    expect(component.formatDelimiterLabel(component.sources()[0]!)).toBe('cadmaPy.importer.formatSmi');
    expect(component.fileRoleLabel(0)).toBe('cadmaPy.importer.guideFile');
    expect(component.fileRoleLabel(1)).toBe('cadmaPy.importer.additionalFile');
    expect(component.roleOptions(0)).toHaveLength(10);
    expect(component.roleOptions(1)[1]?.label).toBe('cadmaPy.importer.smilesMatch');
  });

  it('elimina una fuente y devuelve etiquetas de delimitadores CSV', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const file = {
      name: 'guide.csv',
      text: vi.fn(() => Promise.resolve('smiles\tname\nCCO\tEthanol\n')),
    } as unknown as File;
    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);
    expect(component.formatDelimiterLabel(component.sources()[0]!)).toBe('cadmaPy.importer.formatCsvTab');
    const sourceId = component.sources()[0]?.id ?? '';
    component.removeSource(sourceId);
    expect(component.sources()).toHaveLength(0);
    expect(component.importerError()).toContain('main SMILES column');
  });

  it('ignora eventos sin archivos y conserva el estado', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    await component.onFilesSelected({ target: null } as unknown as Event);
    await component.onFilesSelected({ target: { files: [] } } as unknown as Event);
    expect(component.sources()).toHaveLength(0);
    expect(component.summaryText()).toBe('No files configured yet.');
  });

  it('reparsea SMI con cabecera y etiquetas CSV normales', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const file = {
      name: 'guide.smi',
      text: vi.fn(() => Promise.resolve('SMILES\tName\nCCO\tEthanol\n')),
    } as unknown as File;
    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const source = component.sources()[0]!;
    component.assignColumnRole(source.id, 'column1', 'smiles');
    component.reparseSource(source.id);
    expect(component.sources()[0]?.previewRows).toEqual([['SMILES', 'Name'], ['CCO', 'Ethanol']]);
    expect(component.sources()[0]?.smilesColumn).toBe('column1');
    expect(component.formatDelimiterLabel(component.sources()[0]!)).toBe('cadmaPy.importer.formatSmi');
  });

  it('reemplaza roles previos y serializa una configuración válida', async () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    const stateChanged = vi.fn();
    component.stateChanged.subscribe(stateChanged);
    const file = {
      name: 'guide.csv',
      text: vi.fn(() => Promise.resolve('smiles,name,doi\nCCO,Ethanol,10.1/x\n')),
    } as unknown as File;
    await component.onFilesSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const sourceId = component.sources()[0]?.id ?? '';
    component.assignColumnRole(sourceId, 'name', 'smiles');
    expect(component.roleForColumn(component.sources()[0]!, 'name')).toBe('smiles');
    expect(component.roleForColumn(component.sources()[0]!, 'smiles')).toBe('');
    expect(component.formatDelimiterLabel(component.sources()[0]!)).toContain('formatCsvDelimiter');
    expect(stateChanged.mock.lastCall?.[0].sourceConfigsJson).toContain('smiles_column');
  });

  it('descarta una configuración inicial no válida y usa valores de fallback', () => {
    const fixture = TestBed.createComponent(CadmaPyImporterComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('initialSourceConfigsJson', JSON.stringify({ filename: 'not-an-array' }));
    fixture.detectChanges();
    expect(component.sources()).toHaveLength(0);
    expect(component.uploadButtonSubtitle()).toContain('first file');
  });
});

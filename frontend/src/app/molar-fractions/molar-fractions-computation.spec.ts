// molar-fractions-computation.spec.ts: Pruebas unitarias para cálculo, etiquetas y procesamiento batch CSV.

import { describe, expect, it } from 'vitest';
import {
  buildBatchCsvContent,
  buildBatchSpeciesRows,
  generateSpeciesLabels,
  parseInitialCharge,
  parsePkaList,
  speciesFractions,
} from './molar-fractions-computation';

describe('molar-fractions-computation', () => {
  it('genera etiquetas numéricas alineadas con el notebook para EDA', () => {
    const labelPayload = generateSpeciesLabels([6.16, 10.26], 2, 'EDA');

    expect(labelPayload.labelsPretty).toEqual(['H₂EDA²⁺', 'HEDA⁺', 'EDA']);
    expect(labelPayload.labelsAscii).toEqual(['H2EDA2+', 'HEDA+', 'EDA']);
    expect(labelPayload.charges).toEqual([2, 1, 0]);
  });

  it('genera etiquetas simbólicas alineadas con el notebook', () => {
    const labelPayload = generateSpeciesLabels([2, 6], 'q', 'A');

    expect(labelPayload.labelsPretty).toEqual(['H₂Aq', 'HAq⁻¹', 'Aq⁻²']);
    expect(labelPayload.labelsAscii).toEqual(['H2Aq', 'HAq-1', 'Aq-2']);
  });

  it('calcula fracciones molares para EDA a pH 7.4', () => {
    const fractions = speciesFractions(7.4, [6.16, 10.26]);

    expect(fractions).toHaveLength(3);
    expect(fractions[0]).toBeCloseTo(0.0543419293, 8);
    expect(fractions[1]).toBeCloseTo(0.9443544986, 8);
    expect(fractions[2]).toBeCloseTo(0.0013035721, 8);
    expect(fractions.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  });

  it('parsea listas pKa en formatos simples', () => {
    expect(parsePkaList('6.16;10.26')).toEqual([6.16, 10.26]);
    expect(parsePkaList('[6.16, 10.26]')).toEqual([6.16, 10.26]);
    expect(parsePkaList(9.9)).toEqual([9.9]);
  });

  it('parsea initial charge como entero o q', () => {
    expect(parseInitialCharge('q')).toBe('q');
    expect(parseInitialCharge('2')).toBe(2);
    expect(parseInitialCharge(-1)).toBe(-1);
  });

  it('procesa un CSV batch y ordena por acrónimo y fracción', () => {
    const csvText = [
      'Acrónimo,SMILES,carga de la especie máximamente protonada,valores de pka',
      'EDA,NCCN,2,6.16;10.26',
      'GLY,NCC(=O)O,-1,2.35;9.78',
    ].join('\n');

    const rows = buildBatchSpeciesRows(csvText, 7.4, 0.01);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.acronym).toBe('EDA');
    expect(rows[0]?.species).toBe('HEDA⁺');
    expect(rows.some((rowValue) => rowValue.acronym === 'GLY')).toBe(true);
  });

  it('construye un CSV exportable desde las filas batch', () => {
    const csvContent = buildBatchCsvContent([
      {
        acronym: 'EDA',
        smiles: 'NCCN',
        pkaValues: [6.16, 10.26],
        pkaValuesText: '6.16; 10.26',
        initialCharge: 2,
        pH: 7.4,
        speciesIndex: 1,
        totalPkaCount: 2,
        protonCount: 1,
        species: 'HEDA⁺',
        speciesAscii: 'HEDA+',
        charge: 1,
        fraction: 0.93258,
      },
    ]);

    expect(csvContent).toContain(
      'Acronym,SMILES,pKaValues,InitialCharge,pH,Species,Species_ASCII,Charge,Fraction',
    );
    expect(csvContent).toContain('EDA,NCCN,6.16; 10.26,2,7.40,HEDA⁺,HEDA+,1,0.93258');
  });
});

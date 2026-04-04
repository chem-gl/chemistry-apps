// smileit-inspection.service.spec.ts: Pruebas unitarias del servicio de inspección SVG Smileit.

import { TestBed } from '@angular/core/testing';
import { SmileitInspectionService, type AnnotationOverlay } from './smileit-inspection.service';

describe('SmileitInspectionService', () => {
  let service: SmileitInspectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SmileitInspectionService);
  });

  it('returns input unchanged when svg markup is empty or invalid', () => {
    // Evita ruido de procesamiento cuando el input no es utilizable.
    expect(service.decorateInspectionSvg('   ', [], [])).toBe('   ');

    const invalidMarkup = '<div>not-an-svg</div>';
    expect(service.decorateInspectionSvg(invalidMarkup, [], [])).toBe(invalidMarkup);
  });

  it('adds atom highlight style marker class only once per decorated svg', () => {
    // Valida el fix de Sonar: marcar style por clase en vez de data-attribute.
    const simpleSvg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

    const outputSvg = service.decorateInspectionSvg(simpleSvg, [], []);
    const parsed = new DOMParser().parseFromString(outputSvg, 'image/svg+xml');

    const styleNodes = parsed.querySelectorAll('style.smileit-atom-highlight');
    expect(styleNodes.length).toBe(1);
    expect(parsed.querySelector('style[data-smileit-atom-highlight="true"]')).toBeNull();
  });

  it('extracts bond segments from rdkit-like path classes and path data', () => {
    // Comprueba parseo de endpoints y atom indices desde clases bond-atomA-atomB.
    const svgDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><path class="bond-0 atom-1 atom-2" d="M 10,20 L 30,40" /></svg>',
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;

    const segments = service.extractBondSegmentsFromSvg(rootSvg);

    expect(segments.length).toBe(1);
    expect(segments[0].atomA).toBe(1);
    expect(segments[0].atomB).toBe(2);
    expect(segments[0].start).toEqual({ x: 10, y: 20 });
    expect(segments[0].end).toEqual({ x: 30, y: 40 });
  });

  it('extracts atom index from event composed path using data-atom-index', () => {
    // Garantiza selección atómica desde overlays interactivos.
    const hitZone = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    (hitZone as unknown as HTMLElement).dataset['atomIndex'] = '7';

    const syntheticEvent = {
      composedPath: () => [hitZone],
    } as unknown as MouseEvent;

    const extractedIndex = service.extractAtomIndexFromEvent(syntheticEvent);

    expect(extractedIndex).toBe(7);
  });

  it('decorates svg with annotation overlays and selected atom vertices', () => {
    // Verifica que el pipeline principal agrega overlays de anotación y selección.
    const baseSvg = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <path class="bond-0 atom-1 atom-2" d="M 10,20 L 30,40" />
        </svg>
      `;
    const annotations: AnnotationOverlay[] = [
      {
        pattern_stable_id: 'pattern-1',
        atom_indices: [1, 2],
        color: '#ff0000',
        caption: 'Test caption',
        name: 'Pattern A',
        pattern_type: 'functional',
      },
    ];

    const outputSvg = service.decorateInspectionSvg(baseSvg, [1], annotations);
    const parsed = new DOMParser().parseFromString(outputSvg, 'image/svg+xml');

    expect(parsed.querySelector('[data-smileit-annotation-overlay="true"]')).not.toBeNull();
    expect(parsed.querySelector('[data-smileit-overlay="true"]')).not.toBeNull();
    expect(parsed.querySelector('.smileit-atom-selected-vertex.atom-1')).not.toBeNull();
  });

  // --- extractAtomIndexFromEvent: ramas adicionales ---

  it('returns null from extractAtomIndexFromEvent when composedPath is not available', () => {
    // Cubre la rama donde el navegador no implementa composedPath (entornos legacy).
    const syntheticEvent = {} as MouseEvent;
    expect(service.extractAtomIndexFromEvent(syntheticEvent)).toBeNull();
  });

  it('skips non-Element nodes in composedPath and returns null when nothing matches', () => {
    // Cubre la rama: eventNode instanceof Element es false (Window, TextNode, etc.).
    const textNode = document.createTextNode('hello');
    const syntheticEvent = {
      composedPath: () => [textNode, globalThis],
    } as unknown as MouseEvent;
    expect(service.extractAtomIndexFromEvent(syntheticEvent)).toBeNull();
  });

  it('returns null when element in path has a bond class (is not an atom target)', () => {
    // Cubre la rama isExplicitAtomSelectionTarget → false cuando clase contiene bond-.
    const bondPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bondPath.setAttribute('class', 'bond-0 atom-1 atom-2');
    const syntheticEvent = {
      composedPath: () => [bondPath],
    } as unknown as MouseEvent;
    expect(service.extractAtomIndexFromEvent(syntheticEvent)).toBeNull();
  });

  it('extracts atom index from atom-N class when element matches but has no dataset', () => {
    // Cubre la discriminación via regex atom-N en clase SVG.
    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('class', 'atom-4');
    const syntheticEvent = {
      composedPath: () => [textEl],
    } as unknown as MouseEvent;
    expect(service.extractAtomIndexFromEvent(syntheticEvent)).toBe(4);
  });

  // --- extractBondSegmentsFromSvg: ramas adicionales ---

  it('skips bond path that only has one atom index in its class', () => {
    // Cubre la rama atomIndices.length < 2 → se ignora el segmento.
    const svgDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><path class="bond-0 atom-1" d="M 10,20 L 30,40" /></svg>',
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const segments = service.extractBondSegmentsFromSvg(rootSvg);
    expect(segments.length).toBe(0);
  });

  it('skips bond path when path data has fewer than 2 coordinate pairs', () => {
    // Cubre la rama parseBondEndpoints === null (sólo 1 coordenada → no se puede formar segmento).
    const svgDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><path class="bond-0 atom-1 atom-2" d="M 10,20" /></svg>',
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const segments = service.extractBondSegmentsFromSvg(rootSvg);
    expect(segments.length).toBe(0);
  });

  it('returns empty segments from SVG with no bond paths', () => {
    // Cubre la rama donde querySelectorAll no encuentra paths bond-.
    const svgDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5" /></svg>',
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    expect(service.extractBondSegmentsFromSvg(rootSvg).length).toBe(0);
  });

  // --- extractAtomPositionsFromBonds: ramas adicionales ---

  it('ignores text elements without an atom-N class', () => {
    // Cubre atomMatch === null → skip de text element sin clase atómica.
    const svgDoc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
          <text class="label" x="5" y="10">C</text>
          <path class="bond-0 atom-0 atom-1" d="M 5,10 L 25,30" />
        </svg>`,
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const positions = service.extractAtomPositionsFromBonds(rootSvg);
    // Los átomos 0 y 1 se infieren desde el bond (no desde el text sin clase atom-N).
    expect(positions.has(0)).toBe(true);
    expect(positions.has(1)).toBe(true);
  });

  it('ignores text elements with non-finite coordinates', () => {
    // Cubre !Number.isFinite(x) || !Number.isFinite(y) → skip cuando atributos son inválidos.
    const svgDoc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
          <text class="atom-3" x="invalid" y="">N</text>
          <path class="bond-0 atom-3 atom-4" d="M 10,20 L 30,40" />
        </svg>`,
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const positions = service.extractAtomPositionsFromBonds(rootSvg);
    // atom-3 tiene coordenadas inválidas → se infiere desde bond endpoint.
    expect(positions.has(3)).toBe(true);
  });

  it('returns only text-based positions when no bond paths exist in SVG', () => {
    // Cubre bondSegments.length === 0 → early return antes del centroide.
    const svgDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><text class="atom-0" x="5" y="10">C</text></svg>',
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const positions = service.extractAtomPositionsFromBonds(rootSvg);
    expect(positions.get(0)).toEqual({ x: 5, y: 10 });
    expect(positions.size).toBe(1);
  });

  it('does not overwrite atom position already found in text element when processing bonds', () => {
    // Cubre la rama atomPositions.has(segment.atomA) → true → skip accumulator.
    const svgDoc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
          <text class="atom-1" x="50" y="60">N</text>
          <path class="bond-0 atom-1 atom-2" d="M 50,60 L 100,80" />
        </svg>`,
      'image/svg+xml',
    );
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement;
    const positions = service.extractAtomPositionsFromBonds(rootSvg);
    // atom-1 ya tenía posición desde <text>, no debe sobreescribirse.
    expect(positions.get(1)).toEqual({ x: 50, y: 60 });
    // atom-2 se infiere desde el endpoint del bond.
    expect(positions.get(2)).toBeDefined();
  });

  // --- decorateInspectionSvg: ramas de anotaciones y overlays ---

  it('decorates svg without adding annotation overlay when annotations array is empty', () => {
    // Cubre annotations.length === 0 → no se crea el grupo de anotación.
    const svgWithBond = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <path class="bond-0 atom-0 atom-1" d="M 10,20 L 30,40" />
        </svg>
      `;
    const output = service.decorateInspectionSvg(svgWithBond, [], []);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    expect(parsed.querySelector('[data-smileit-annotation-overlay="true"]')).toBeNull();
  });

  it('does not add selected-vertex circle for atoms not in selectedAtomIndices', () => {
    // Cubre selectedAtomSet.has(atomIndex) === false → no se dibuja el círculo de selección.
    const svgWithBond = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <path class="bond-0 atom-0 atom-1" d="M 10,20 L 30,40" />
        </svg>
      `;
    const output = service.decorateInspectionSvg(svgWithBond, [], []);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    // Overlay de hit-zones debe estar, pero sin vértices seleccionados.
    expect(parsed.querySelector('[data-smileit-overlay="true"]')).not.toBeNull();
    expect(parsed.querySelector('.smileit-atom-selected-vertex')).toBeNull();
  });

  it('annotation overlay includes only bonds whose atoms are both in annotation', () => {
    // Cubre la rama donde bond NO está en annotationAtomSet → se ignora.
    const svgWithBonds = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <path class="bond-0 atom-0 atom-1" d="M 10,20 L 30,40" />
          <path class="bond-1 atom-2 atom-3" d="M 50,60 L 70,80" />
        </svg>
      `;
    const annotations: AnnotationOverlay[] = [
      {
        pattern_stable_id: 'p1',
        atom_indices: [0, 1],
        color: '#00ff00',
        caption: 'Test',
        name: 'Pattern',
        pattern_type: 'functional',
      },
    ];
    const output = service.decorateInspectionSvg(svgWithBonds, [], annotations);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    const overlayGroup = parsed.querySelector('[data-smileit-annotation-overlay="true"]');
    expect(overlayGroup).not.toBeNull();
    // Solo 1 path de bond (bond-0) debería aparecer en el overlay.
    const overlayPaths = overlayGroup?.querySelectorAll('path');
    expect(overlayPaths?.length).toBe(1);
  });

  it('does not create annotation overlay when no atom positions are available', () => {
    // Cubre atomPositions.size === 0 → early return en drawAnnotationOverlays.
    // Sin bonds ni texto atom-N en el SVG no hay posiciones disponibles.
    const svgSimple = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    const annotations: AnnotationOverlay[] = [
      {
        pattern_stable_id: 'p1',
        atom_indices: [99],
        color: '#ff0000',
        caption: 'Ghost',
        name: 'Ghost pattern',
        pattern_type: 'functional',
      },
    ];
    const output = service.decorateInspectionSvg(svgSimple, [], annotations);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    // Sin posiciones de átomos → no se crea el grupo de anotación.
    expect(parsed.querySelector('[data-smileit-annotation-overlay="true"]')).toBeNull();
  });

  it('skips annotation atom circle when atom index has no position in the map', () => {
    // Cubre atomPositions.get(atomIndex) === undefined → skip círculo en anotación.
    // SVG con bond que define posiciones sólo para átomos 0 y 1, pero anotación pide átomo 99.
    const svgWithBond = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <path class="bond-0 atom-0 atom-1" d="M 10,20 L 30,40" />
        </svg>
      `;
    const annotations: AnnotationOverlay[] = [
      {
        pattern_stable_id: 'p-missing',
        atom_indices: [0, 99],
        color: '#ff0000',
        caption: 'Partial',
        name: 'Partial pattern',
        pattern_type: 'functional',
      },
    ];
    const output = service.decorateInspectionSvg(svgWithBond, [], annotations);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    const overlayGroup = parsed.querySelector('[data-smileit-annotation-overlay="true"]');
    expect(overlayGroup).not.toBeNull();
    // Sólo 1 círculo (átomo 0), no 2 (átomo 99 no tiene posición).
    expect(overlayGroup?.querySelectorAll('circle').length).toBe(1);
  });

  it('does not re-insert style node when already present in SVG', () => {
    // Cubre existingStyleNode !== null → return early en ensureAtomHighlightStyle.
    const simpleSvg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const firstOutput = service.decorateInspectionSvg(simpleSvg, [], []);
    // Segunda decoración con el SVG ya decorado (style ya existe).
    const secondOutput = service.decorateInspectionSvg(firstOutput, [], []);
    const parsed = new DOMParser().parseFromString(secondOutput, 'image/svg+xml');
    // Solo debe haber un nodo style de highlight (no duplicado).
    expect(parsed.querySelectorAll('style.smileit-atom-highlight').length).toBe(1);
  });

  it('appends annotation overlay group when svg has no bond paths (no insertBefore target)', () => {
    // Cubre firstBondNode === null → se usa appendChild en lugar de insertBefore.
    const svgNoBonds = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const annotations: AnnotationOverlay[] = [
      {
        pattern_stable_id: 'p-nobond',
        atom_indices: [],
        color: '#aabbcc',
        caption: 'No bond',
        name: 'NoBond',
        pattern_type: 'functional',
      },
    ];
    const output = service.decorateInspectionSvg(svgNoBonds, [], annotations);
    expect(output).toContain('svg');
  });

  it('skips drawAtomVertexOverlays when no atom positions were extracted', () => {
    // Cubre atomPositions.size === 0 → early return sin crear overlay group.
    // SVG válido sin bonds ni texto atómico → sin posiciones.
    const svgEmpty = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" /></svg>';
    const output = service.decorateInspectionSvg(svgEmpty, [1, 2], []);
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml');
    // No debe crearse el overlay group cuando no hay posiciones atómicas.
    expect(parsed.querySelector('[data-smileit-overlay="true"]')).toBeNull();
  });
});

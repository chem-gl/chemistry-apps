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
});

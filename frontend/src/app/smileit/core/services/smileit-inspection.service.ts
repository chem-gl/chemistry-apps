// smileit-inspection.service.ts: Servicio de análisis e inspección de estructuras (SVG, átomos, decoraciones).
// Responsabilidad: manejar lógica compleja de SVG parsing, decoración, extracción de posiciones atómicas.
// Uso: inyectar cuando se necesita renderizar SVG inspeccionable o procesar clics en átomos.

import { Injectable } from '@angular/core';

export interface AnnotationOverlay {
  pattern_stable_id: string;
  atom_indices: number[];
  color: string;
  caption: string;
  name: string;
  pattern_type: string;
}

export interface BondSegment {
  atomA: number;
  atomB: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  pathData: string;
}

/**
 * Encapsula lógica de decoración SVG, extracción de coordenadas atómicas y manejo de selecciones.
 * Evitar que el componente tenga cientos de líneas de SVG parsing/decoración.
 */
@Injectable({ providedIn: 'root' })
export class SmileitInspectionService {
  /**
   * Decora un SVG con highlights de anotaciones y puntos de selección atómica.
   * @param rawSvgMarkup SVG original sin decoraciones
   * @param selectedAtomIndices Índices de átomos seleccionados
   * @param annotations Anotaciones de patrones a destacar
   * @returns SVG decorado con overlays visibles
   */
  decorateInspectionSvg(
    rawSvgMarkup: string,
    selectedAtomIndices: number[],
    annotations: AnnotationOverlay[],
  ): string {
    if (rawSvgMarkup.trim() === '') {
      return rawSvgMarkup;
    }

    const domParser: DOMParser = new DOMParser();
    const parsedDocument: Document = domParser.parseFromString(rawSvgMarkup, 'image/svg+xml');
    const rootSvg: SVGSVGElement | null = parsedDocument.querySelector('svg');
    if (rootSvg === null) {
      return rawSvgMarkup;
    }

    const atomPositions: Map<number, { x: number; y: number }> =
      this.extractAtomPositionsFromBonds(rootSvg);
    this.ensureAtomHighlightStyle(rootSvg, parsedDocument);
    this.drawAnnotationOverlays(rootSvg, parsedDocument, annotations, atomPositions);
    this.drawAtomVertexOverlays(rootSvg, parsedDocument, selectedAtomIndices, atomPositions);

    return rootSvg.outerHTML;
  }

  /**
   * Extrae el índice atómico desde un click en el SVG.
   * Busca a través del composed path del evento.
   */
  extractAtomIndexFromEvent(mouseEvent: MouseEvent): number | null {
    const composedPathMethod: (() => EventTarget[]) | undefined =
      mouseEvent.composedPath?.bind(mouseEvent);

    if (composedPathMethod !== undefined) {
      const eventPath: EventTarget[] = composedPathMethod();
      for (const eventNode of eventPath) {
        if (!(eventNode instanceof Element)) {
          continue;
        }

        const atomIndexFromElement: number | null = this.extractAtomIndexFromElement(eventNode);
        if (atomIndexFromElement !== null) {
          return atomIndexFromElement;
        }
      }
    }

    return null;
  }

  /**
   * Lee posiciones de átomos desde un SVG RDKit.
   * Maneja el caso de bonds dobles que desplazan las líneas del eje real.
   */
  extractAtomPositionsFromBonds(rootSvg: SVGSVGElement): Map<number, { x: number; y: number }> {
    const atomPositions: Map<number, { x: number; y: number }> = new Map();

    // Paso 1: extraer posiciones desde <text class="atom-N"> (heteroátomos)
    rootSvg.querySelectorAll('text').forEach((textElement: Element) => {
      const classText: string = this.normalizeClassText(textElement.getAttribute('class') ?? '');
      const atomMatch: RegExpExecArray | null = /\batom-(\d+)\b/.exec(classText);
      if (atomMatch === null) {
        return;
      }
      const atomIndex: number = Number.parseInt(atomMatch[1], 10);
      const x: number = Number.parseFloat(textElement.getAttribute('x') ?? '');
      const y: number = Number.parseFloat(textElement.getAttribute('y') ?? '');
      if (Number.isFinite(x) && Number.isFinite(y)) {
        atomPositions.set(atomIndex, { x, y });
      }
    });

    // Paso 2: centroide de endpoints para átomos sin etiqueta (carbonos implícitos)
    const bondSegments = this.extractBondSegmentsFromSvg(rootSvg);
    if (bondSegments.length === 0) {
      return atomPositions;
    }

    const endpointAccumulator: Map<number, Array<{ x: number; y: number }>> = new Map();

    for (const segment of bondSegments) {
      if (!atomPositions.has(segment.atomA)) {
        const list = endpointAccumulator.get(segment.atomA) ?? [];
        list.push(segment.start);
        endpointAccumulator.set(segment.atomA, list);
      }
      if (!atomPositions.has(segment.atomB)) {
        const list = endpointAccumulator.get(segment.atomB) ?? [];
        list.push(segment.end);
        endpointAccumulator.set(segment.atomB, list);
      }
    }

    for (const [atomIndex, endpoints] of endpointAccumulator) {
      if (endpoints.length === 0) {
        continue;
      }
      const centroidX: number = endpoints.reduce((sum, p) => sum + p.x, 0) / endpoints.length;
      const centroidY: number = endpoints.reduce((sum, p) => sum + p.y, 0) / endpoints.length;
      atomPositions.set(atomIndex, { x: centroidX, y: centroidY });
    }

    return atomPositions;
  }

  /**
   * Extrae todos los segmentos de bond desde el SVG RDKit.
   */
  extractBondSegmentsFromSvg(rootSvg: SVGSVGElement): BondSegment[] {
    const bondSegments: BondSegment[] = [];

    rootSvg.querySelectorAll('path[class*="bond-"]').forEach((bondElement: Element) => {
      const classNameText: string = this.normalizeClassText(
        bondElement.getAttribute('class') ?? '',
      );
      const atomIndices: number[] = this.parseAtomIndices(classNameText);
      if (atomIndices.length < 2) {
        return;
      }

      const pathData: string = bondElement.getAttribute('d') ?? '';
      const endpoints = this.parseBondEndpoints(pathData);
      if (endpoints === null) {
        return;
      }

      bondSegments.push({
        atomA: atomIndices[0],
        atomB: atomIndices[1],
        start: endpoints.start,
        end: endpoints.end,
        pathData,
      });
    });

    return bondSegments;
  }

  private extractAtomIndexFromElement(svgElement: Element): number | null {
    let currentElement: Element | null = svgElement;
    while (currentElement !== null) {
      if (!this.isExplicitAtomSelectionTarget(currentElement)) {
        currentElement = currentElement.parentElement;
        continue;
      }

      const atomIndices: number[] = this.readAtomIndicesFromElement(currentElement);
      if (atomIndices.length > 0) {
        return atomIndices[0];
      }
      currentElement = currentElement.parentElement;
    }

    return null;
  }

  private isExplicitAtomSelectionTarget(svgElement: Element): boolean {
    if ('atomIndex' in (svgElement as HTMLElement).dataset) {
      return true;
    }

    const normalizedClassText: string = this.normalizeClassText(svgElement.className);
    const rawId: string = svgElement.getAttribute('id') ?? '';
    const combinedIdentity: string = `${normalizedClassText} ${rawId}`.trim();
    if (combinedIdentity === '') {
      return false;
    }

    if (combinedIdentity.includes('bond-')) {
      return false;
    }

    return /(^|\s)smileit-atom-hit-zone(\s|$)|(^|\s)smileit-atom-selected-vertex(\s|$)|atom-\d+/.test(
      combinedIdentity,
    );
  }

  private readAtomIndicesFromElement(svgElement: Element): number[] {
    const normalizedClassText: string = this.normalizeClassText(svgElement.className);
    const rawId: string = svgElement.getAttribute('id') ?? '';
    const rawDataAtomIndex: string = (svgElement as HTMLElement).dataset['atomIndex'] ?? '';

    const atomIndexCandidates: string[] = [
      normalizedClassText,
      rawId,
      rawDataAtomIndex.length > 0 ? `atom-${rawDataAtomIndex}` : '',
    ].filter((candidateText: string) => candidateText.trim() !== '');

    const parsedIndices: number[] = atomIndexCandidates.flatMap((candidateText: string) =>
      this.parseAtomIndices(candidateText),
    );

    return Array.from(new Set(parsedIndices));
  }

  private drawAnnotationOverlays(
    rootSvg: SVGSVGElement,
    parsedDocument: Document,
    annotations: AnnotationOverlay[],
    atomPositions: Map<number, { x: number; y: number }>,
  ): void {
    rootSvg
      .querySelectorAll('[data-smileit-annotation-overlay="true"]')
      .forEach((overlayNode: Element) => {
        overlayNode.remove();
      });

    if (annotations.length === 0 || atomPositions.size === 0) {
      return;
    }

    const bondSegments = this.extractBondSegmentsFromSvg(rootSvg);
    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const overlayGroup: SVGGElement = parsedDocument.createElementNS(
      svgNamespace,
      'g',
    ) as SVGGElement;
    (overlayGroup as unknown as HTMLElement).dataset['smileitAnnotationOverlay'] = 'true';

    const defsElement: SVGDefsElement = parsedDocument.createElementNS(
      svgNamespace,
      'defs',
    ) as SVGDefsElement;

    const filterIds: Map<string, string> = new Map();
    annotations.forEach((annotation, annotationIndex: number) => {
      const filterId: string = `smileit-highlight-${annotationIndex}`;
      filterIds.set(annotation.pattern_stable_id, filterId);

      const highlightFilter: SVGFilterElement = parsedDocument.createElementNS(
        svgNamespace,
        'filter',
      ) as SVGFilterElement;
      highlightFilter.setAttribute('id', filterId);
      highlightFilter.setAttribute('x', '-60%');
      highlightFilter.setAttribute('y', '-60%');
      highlightFilter.setAttribute('width', '220%');
      highlightFilter.setAttribute('height', '220%');

      const blurElement: SVGFEGaussianBlurElement = parsedDocument.createElementNS(
        svgNamespace,
        'feGaussianBlur',
      ) as SVGFEGaussianBlurElement;
      blurElement.setAttribute('in', 'SourceGraphic');
      blurElement.setAttribute('stdDeviation', '2.2');
      highlightFilter.appendChild(blurElement);
      defsElement.appendChild(highlightFilter);
    });
    overlayGroup.appendChild(defsElement);

    annotations.forEach((annotation) => {
      const annotationAtomSet: Set<number> = new Set(annotation.atom_indices);
      const filterId: string = filterIds.get(annotation.pattern_stable_id) ?? '';

      bondSegments.forEach((bondSegment) => {
        if (
          !annotationAtomSet.has(bondSegment.atomA) ||
          !annotationAtomSet.has(bondSegment.atomB)
        ) {
          return;
        }

        const bondHighlight: SVGPathElement = parsedDocument.createElementNS(
          svgNamespace,
          'path',
        ) as SVGPathElement;
        bondHighlight.setAttribute('d', bondSegment.pathData);
        bondHighlight.setAttribute('fill', 'none');
        bondHighlight.setAttribute('stroke', annotation.color);
        bondHighlight.setAttribute('stroke-width', '12');
        bondHighlight.setAttribute('stroke-linecap', 'round');
        bondHighlight.setAttribute('stroke-linejoin', 'round');
        bondHighlight.setAttribute('stroke-opacity', '0.55');
        bondHighlight.setAttribute('filter', `url(#${filterId})`);
        (bondHighlight as unknown as HTMLElement).dataset['smileitHitZone'] = 'true';
        bondHighlight.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(bondHighlight);
      });

      annotation.atom_indices.forEach((atomIndex: number) => {
        const atomPosition = atomPositions.get(atomIndex);
        if (atomPosition === undefined) {
          return;
        }

        const atomHighlight: SVGCircleElement = parsedDocument.createElementNS(
          svgNamespace,
          'circle',
        ) as SVGCircleElement;
        atomHighlight.setAttribute('cx', atomPosition.x.toFixed(2));
        atomHighlight.setAttribute('cy', atomPosition.y.toFixed(2));
        atomHighlight.setAttribute('r', '8');
        atomHighlight.setAttribute('fill', annotation.color);
        atomHighlight.setAttribute('fill-opacity', '0.50');
        atomHighlight.setAttribute('stroke', 'none');
        atomHighlight.setAttribute('filter', `url(#${filterId})`);
        (atomHighlight as unknown as HTMLElement).dataset['smileitHitZone'] = 'true';
        atomHighlight.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(atomHighlight);
      });
    });

    const firstBondNode: Element | null = rootSvg.querySelector(
      'path[class*="bond-"], line[class*="bond-"]',
    );
    if (firstBondNode !== null && firstBondNode.parentNode === rootSvg) {
      firstBondNode.before(overlayGroup);
      return;
    }

    rootSvg.appendChild(overlayGroup);
  }

  private drawAtomVertexOverlays(
    rootSvg: SVGSVGElement,
    parsedDocument: Document,
    selectedAtomIndices: number[],
    atomPositions: Map<number, { x: number; y: number }>,
  ): void {
    if (atomPositions.size === 0) {
      return;
    }

    rootSvg.querySelectorAll('[data-smileit-overlay="true"]').forEach((overlayNode: Element) => {
      overlayNode.remove();
    });

    const selectedAtomSet: Set<number> = new Set(selectedAtomIndices);
    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const overlayGroup: SVGGElement = parsedDocument.createElementNS(
      svgNamespace,
      'g',
    ) as SVGGElement;
    (overlayGroup as unknown as HTMLElement).dataset['smileitOverlay'] = 'true';

    for (const [atomIndex, atomPosition] of atomPositions.entries()) {
      const hitZoneCircle: SVGCircleElement = parsedDocument.createElementNS(
        svgNamespace,
        'circle',
      ) as SVGCircleElement;
      hitZoneCircle.setAttribute('cx', atomPosition.x.toFixed(2));
      hitZoneCircle.setAttribute('cy', atomPosition.y.toFixed(2));
      hitZoneCircle.setAttribute('r', '12');
      hitZoneCircle.setAttribute('fill', 'transparent');
      hitZoneCircle.setAttribute('stroke', 'transparent');
      hitZoneCircle.setAttribute('class', `smileit-atom-hit-zone atom-${atomIndex}`);
      (hitZoneCircle as unknown as HTMLElement).dataset['atomIndex'] = String(atomIndex);
      (hitZoneCircle as unknown as HTMLElement).dataset['smileitHitZone'] = 'true';
      hitZoneCircle.setAttribute('style', 'pointer-events: all; cursor: crosshair;');
      overlayGroup.appendChild(hitZoneCircle);

      if (selectedAtomSet.has(atomIndex)) {
        const selectedCircle: SVGCircleElement = parsedDocument.createElementNS(
          svgNamespace,
          'circle',
        ) as SVGCircleElement;
        selectedCircle.setAttribute('cx', atomPosition.x.toFixed(2));
        selectedCircle.setAttribute('cy', atomPosition.y.toFixed(2));
        selectedCircle.setAttribute('r', '10');
        selectedCircle.setAttribute('class', `smileit-atom-selected-vertex atom-${atomIndex}`);
        (selectedCircle as unknown as HTMLElement).dataset['smileitSelectedVertex'] = 'true';
        selectedCircle.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(selectedCircle);
      }
    }

    rootSvg.appendChild(overlayGroup);
  }

  private normalizeClassText(classNameValue: unknown): string {
    if (typeof classNameValue === 'string') {
      return classNameValue;
    }

    return ((classNameValue as { baseVal?: string } | null)?.baseVal ?? '').trim();
  }

  private parseAtomIndices(rawText: string): number[] {
    const atomRegex: RegExp = /atom-(\d+)/g;
    const indices: number[] = [];

    for (const regexMatch of rawText.matchAll(atomRegex)) {
      const rawIndex: string | undefined = regexMatch[1];
      if (rawIndex === undefined) {
        continue;
      }

      const parsedIndex: number = Number(rawIndex);
      if (Number.isInteger(parsedIndex) && parsedIndex >= 0) {
        indices.push(parsedIndex);
      }
    }

    return indices;
  }

  private parseBondEndpoints(pathData: string): {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null {
    const coordinatePairs: Array<{ x: number; y: number }> = Array.from(
      // nosonar ignorar siempre regex complejos s
      pathData.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g), // NOSONAR typescript:S5852 - no false positive, se necesita el regex global para matchAll
      (regexMatch) => ({
        x: Number(regexMatch[1]),
        y: Number(regexMatch[2]),
      }),
    ).filter((coordinate) => Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y));

    if (coordinatePairs.length < 2) {
      return null;
    }

    return {
      start: coordinatePairs[0],
      end: coordinatePairs.at(-1)!,
    };
  }

  private ensureAtomHighlightStyle(rootSvg: SVGSVGElement, parsedDocument: Document): void {
    const existingStyleNode: Element | null = parsedDocument.querySelector(
      'style.smileit-atom-highlight',
    );
    if (existingStyleNode !== null) {
      return;
    }

    // Se marca por clase CSS para evitar atributos data-* en nodos SVG de estilo.
    const styleNode: Element = parsedDocument.createElement('style');
    styleNode.classList.add('smileit-atom-highlight');
    styleNode.textContent = `
      .smileit-atom-selected-vertex {
        stroke: #f97316 !important;
        fill: rgba(249, 115, 22, 0.08) !important;
        stroke-width: 3px !important;
      }
    `;

    rootSvg.prepend(styleNode);
  }
}

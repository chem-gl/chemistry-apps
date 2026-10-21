import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const CADMA_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'cadmaPy.doc.tabOverview',
    contentKey: 'scientificDoc.docs.cadmaPy.overview',
  },
  {
    id: 'workflow',
    titleKey: 'cadmaPy.doc.tabWorkflow',
    contentKey: 'scientificDoc.docs.cadmaPy.workflow',
  },
  {
    id: 'adme-intervals',
    titleKey: 'cadmaPy.doc.tabAdmeIntervals',
    contentKey: 'scientificDoc.docs.cadmaPy.adme-intervals',
  },
  {
    id: 'adme-properties',
    titleKey: 'cadmaPy.doc.tabAdmeProperties',
    contentKey: 'scientificDoc.docs.cadmaPy.adme-properties',
  },
  {
    id: 'reference-sets',
    titleKey: 'cadmaPy.doc.tabReferenceSets',
    contentKey: 'scientificDoc.docs.cadmaPy.reference-sets',
  },
  {
    id: 'selection-scores',
    titleKey: 'cadmaPy.doc.tabSelectionScores',
    contentKey: 'scientificDoc.docs.cadmaPy.selection-scores',
  },
  {
    id: 'conformers',
    titleKey: 'cadmaPy.doc.tabConformers',
    contentKey: 'scientificDoc.docs.cadmaPy.conformers',
  },
];

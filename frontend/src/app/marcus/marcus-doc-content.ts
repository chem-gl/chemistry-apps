import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const MARCUS_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'scientificDoc.tabOverview',
    contentKey: 'scientificDoc.docs.marcus.overview',
  },
  {
    id: 'formulas',
    titleKey: 'scientificDoc.tabFormulas',
    contentKey: 'scientificDoc.docs.marcus.formulas',
  },
  {
    id: 'example',
    titleKey: 'scientificDoc.tabExample',
    contentKey: 'scientificDoc.docs.marcus.example',
  },
  {
    id: 'references',
    titleKey: 'scientificDoc.tabReferences',
    contentKey: 'scientificDoc.docs.marcus.references',
  },
];

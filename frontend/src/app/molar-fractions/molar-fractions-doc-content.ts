import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const MOLAR_FRACTIONS_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'scientificDoc.tabOverview',
    contentKey: 'scientificDoc.docs.molarFractions.overview',
  },
  {
    id: 'algorithm',
    titleKey: 'scientificDoc.tabAlgorithm',
    contentKey: 'scientificDoc.docs.molarFractions.algorithm',
  },
  {
    id: 'references',
    titleKey: 'scientificDoc.tabReferences',
    contentKey: 'scientificDoc.docs.molarFractions.references',
  },
];

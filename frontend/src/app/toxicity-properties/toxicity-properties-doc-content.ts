import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const TOXICITY_PROPERTIES_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'scientificDoc.tabOverview',
    contentKey: 'scientificDoc.docs.toxicityProperties.overview',
  },
  {
    id: 'interpretation',
    titleKey: 'scientificDoc.tabInterpretation',
    contentKey: 'scientificDoc.docs.toxicityProperties.interpretation',
  },
  {
    id: 'references',
    titleKey: 'scientificDoc.tabReferences',
    contentKey: 'scientificDoc.docs.toxicityProperties.references',
  },
];

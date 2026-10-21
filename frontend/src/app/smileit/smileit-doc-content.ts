import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const SMILEIT_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'scientificDoc.tabOverview',
    contentKey: 'scientificDoc.docs.smileit.overview',
  },
  {
    id: 'workflow',
    titleKey: 'scientificDoc.tabWorkflow',
    contentKey: 'scientificDoc.docs.smileit.workflow',
  },
  {
    id: 'algorithm',
    titleKey: 'scientificDoc.tabAlgorithm',
    contentKey: 'scientificDoc.docs.smileit.algorithm',
  },
  {
    id: 'references',
    titleKey: 'scientificDoc.tabReferences',
    contentKey: 'scientificDoc.docs.smileit.references',
  },
];

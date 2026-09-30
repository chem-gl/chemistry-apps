// app-doc.registry.ts: Registro de manuales (documentacion) por app del hub.
//
// El hub necesita abrir el manual de cada tarjeta sin navegar a la app. Cada
// entrada apunta al contenido `DocTab[]` de la app correspondiente. Si una app
// no tiene manual, la tarjeta muestra "Proximamente" en su lugar.

import { CADMA_DOC_TABS } from '../cadma-py/cadma-py-doc-content';
import { EASY_RATE_DOC_TABS } from '../easy-rate/easy-rate-doc-content';
import { MARCUS_DOC_TABS } from '../marcus/marcus-doc-content';
import { MOLAR_FRACTIONS_DOC_TABS } from '../molar-fractions/molar-fractions-doc-content';
import { SA_SCORE_DOC_TABS } from '../sa-score/sa-score-doc-content';
import { SMILEIT_DOC_TABS } from '../smileit/smileit-doc-content';
import { TOXICITY_PROPERTIES_DOC_TABS } from '../toxicity-properties/toxicity-properties-doc-content';
import { TUNNEL_DOC_TABS } from '../tunnel/tunnel-doc-content';
import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

const SCIENTIFIC_APP_DOC_TABS: Readonly<Record<string, DocTab[]>> = {
  'molar-fractions': MOLAR_FRACTIONS_DOC_TABS,
  tunnel: TUNNEL_DOC_TABS,
  'easy-rate': EASY_RATE_DOC_TABS,
  marcus: MARCUS_DOC_TABS,
  smileit: SMILEIT_DOC_TABS,
  'sa-score': SA_SCORE_DOC_TABS,
  'toxicity-properties': TOXICITY_PROPERTIES_DOC_TABS,
  'cadma-py': CADMA_DOC_TABS,
};

/** Devuelve las pestanas del manual de una app, o `null` si aun no tiene. */
export function getScientificAppDocTabs(appKey: string): DocTab[] | null {
  return SCIENTIFIC_APP_DOC_TABS[appKey] ?? null;
}

// scientific-apps.config.ts: Registro frontend de apps cientificas navegables.
// Los titulos y descripciones se traducen via i18n usando la clave
// `scientificApps.<key>.title` y `scientificApps.<key>.description` en los templates.
// Los campos `title`/`description` sirven como fallback en ingles.

/** Familia a la que pertenece una app en el hub (`CADMA` vs `Others` vs `Server`). */
export type ScientificAppGroup = 'cadma' | 'others' | 'server';

export interface ScientificAppRouteItem {
  key: string;
  pluginName: string;
  /** Titulo traducible via i18n: `scientificApps.<key>.title` */
  title: string;
  /** Descripcion traducible via i18n: `scientificApps.<key>.description` */
  description: string;
  routePath: string;
  available: boolean;
  /** Columna del hub donde se agrupa la app. */
  group: ScientificAppGroup;
  /** Si es false, la app no se muestra en menus ni en el hub (solo existe como ejemplo/ruta interna). */
  visibleInMenus: boolean;
  /** Si es true, la app se puede usar sin cuenta desde el modo libre. */
  freeAccess: boolean;
  /** Captura real de la app (tarjeta principal del hub). Opcional: sin ella se usa la ilustración. */
  thumbnailScreenshot?: string;
  /** Ilustración representativa (vistas secundarias y fallback). Opcional. */
  thumbnailIllustration?: string;
  /** Icono circular de la app (assets/*.png). Opcional: sin él se usa la ilustración. */
  iconAsset?: string;
  /** Srcset WebP del icono (80w/160w). Opcional: acompaña a `iconAsset`. */
  iconAssetSrcSet?: string;
}

interface ScientificAppDefinition {
  key: string;
  pluginName: string;
  title: string;
  description: string;
  visibleInMenus: boolean;
  freeAccess: boolean;
  group: ScientificAppGroup;
  thumbnailScreenshot?: string;
  thumbnailIllustration?: string;
  iconAsset?: string;
  iconAssetSrcSet?: string;
}

function createScientificAppRouteItem(definition: ScientificAppDefinition): ScientificAppRouteItem {
  return {
    key: definition.key,
    pluginName: definition.pluginName,
    title: definition.title,
    description: definition.description,
    routePath: `/${definition.key}`,
    available: true,
    group: definition.group,
    visibleInMenus: definition.visibleInMenus,
    freeAccess: definition.freeAccess,
    thumbnailScreenshot: definition.thumbnailScreenshot,
    thumbnailIllustration: definition.thumbnailIllustration,
    iconAsset: definition.iconAsset,
    iconAssetSrcSet: definition.iconAssetSrcSet,
  };
}

/** Clave i18n para el titulo de una app. Se usa en templates via `| transloco`. */
export function scientificAppTitleKey(appKey: string): string {
  return `scientificApps.${appKey}.title`;
}

/** Clave i18n para la descripcion de una app. Se usa en templates via `| transloco`. */
export function scientificAppDescriptionKey(appKey: string): string {
  return `scientificApps.${appKey}.description`;
}

const SCIENTIFIC_APP_DEFINITIONS: ReadonlyArray<ScientificAppDefinition> = [
  {
    key: 'molar-fractions',
    pluginName: 'molar-fractions',
    title: 'Molar Fractions',
    description: 'Acid-base equilibrium molar fractions with f0..fn table and detailed logs.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'others',
    thumbnailScreenshot: 'assets/thumbnails/molar-fractions.jpg',
    iconAsset: 'assets/thumbnails/icons/pka_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/pka_app_icon-80.webp 80w, assets/thumbnails/icons/pka_app_icon-160.webp 160w',
  },
  {
    key: 'tunnel',
    pluginName: 'tunnel-effect',
    title: 'Tunnel Effect',
    description:
      'Asymmetric Eckart tunneling correction with full input modification trace and job logs.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'others',
    thumbnailScreenshot: 'assets/thumbnails/tunnel.jpg',
    iconAsset: 'assets/thumbnails/icons/tunnel_effect_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/tunnel_effect_app_icon-80.webp 80w, assets/thumbnails/icons/tunnel_effect_app_icon-160.webp 160w',
  },
  {
    key: 'easy-rate',
    pluginName: 'easy-rate',
    title: 'Easy-rate',
    description:
      'TST + Eckart tunnel rate constants from Gaussian log files with optional diffusion correction.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'others',
    thumbnailScreenshot: 'assets/thumbnails/easy-rate.jpg',
    iconAsset: 'assets/thumbnails/icons/tst_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/tst_app_icon-80.webp 80w, assets/thumbnails/icons/tst_app_icon-160.webp 160w',
  },
  {
    key: 'marcus',
    pluginName: 'marcus-kinetics',
    title: 'Marcus Theory',
    description:
      'Marcus energies, reorganization energy, barrier and rate constants from six Gaussian log files.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'others',
    thumbnailScreenshot: 'assets/thumbnails/marcus.jpg',
    iconAsset: 'assets/thumbnails/icons/marcus_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/marcus_app_icon-80.webp 80w, assets/thumbnails/icons/marcus_app_icon-160.webp 160w',
  },
  {
    key: 'smileit',
    pluginName: 'smileit',
    title: 'Smileit',
    description:
      'Combinatorial SMILES generation with atom-index inspection, substituent catalog and report exports.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'cadma',
    thumbnailScreenshot: 'assets/thumbnails/smileit.jpg',
    iconAsset: 'assets/thumbnails/icons/smileit_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/smileit_app_icon-80.webp 80w, assets/thumbnails/icons/smileit_app_icon-160.webp 160w',
  },
  {
    key: 'sa-score',
    pluginName: 'sa-score',
    title: 'SA Score',
    description:
      'Synthetic accessibility scoring for SMILES batches using AMBIT, BRSAScore and RDKit methods.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'cadma',
    thumbnailScreenshot: 'assets/thumbnails/sa-score.jpg',
    iconAsset: 'assets/thumbnails/icons/synth_access_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/synth_access_app_icon-80.webp 80w, assets/thumbnails/icons/synth_access_app_icon-160.webp 160w',
  },
  {
    key: 'toxicity-properties',
    pluginName: 'toxicity-properties',
    title: 'Toxicity Properties',
    description:
      'ADMET-AI toxicity table for LD50, Ames mutagenicity and developmental toxicity from SMILES batches.',
    visibleInMenus: true,
    freeAccess: true,
    group: 'cadma',
    thumbnailScreenshot: 'assets/thumbnails/toxicity-properties.jpg',
    iconAsset: 'assets/thumbnails/icons/toxicity_app_icon-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/toxicity_app_icon-80.webp 80w, assets/thumbnails/icons/toxicity_app_icon-160.webp 160w',
  },
  {
    key: 'cadma-py',
    pluginName: 'cadma-py',
    title: 'CADMA Py',
    description:
      'Reference-family management, transparent selection scores and ergonomic comparison charts for compound prioritization.',
    visibleInMenus: true,
    // Con cuenta siempre: sin ruta pública en el backend (docs §19).
    freeAccess: false,
    group: 'cadma',
    thumbnailScreenshot: 'assets/thumbnails/cadma-py.jpg',
    iconAsset: 'assets/thumbnails/icons/cadmapy_v3_noboxes-160.webp',
    iconAssetSrcSet: 'assets/thumbnails/icons/cadmapy_v3_noboxes-80.webp 80w, assets/thumbnails/icons/cadmapy_v3_noboxes-160.webp 160w',
  },
  {
    key: 'server-calc',
    pluginName: 'server-calc',
    title: 'Server Calc',
    description:
      'Proof-of-concept remote calculation on the qta server over SSH with result file logging. Admins only.',
    visibleInMenus: true,
    freeAccess: false,
    group: 'server',
  },
];

export const SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_DEFINITIONS.map(createScientificAppRouteItem);

export function findScientificAppRouteItemByRouteKey(
  routeKey: string,
): ScientificAppRouteItem | undefined {
  return SCIENTIFIC_APP_ROUTE_ITEMS.find((appItem) => appItem.key === routeKey);
}

export function findScientificAppRouteItemByPluginName(
  pluginName: string,
): ScientificAppRouteItem | undefined {
  return SCIENTIFIC_APP_ROUTE_ITEMS.find((appItem) => appItem.pluginName === pluginName);
}

export function resolveScientificJobRouteKey(pluginName: string): string | null {
  return findScientificAppRouteItemByPluginName(pluginName)?.key ?? null;
}

export function resolveScientificJobRoutePath(pluginName: string): string | null {
  const routeKey = resolveScientificJobRouteKey(pluginName);
  if (routeKey === null) {
    return null;
  }

  return findScientificAppRouteItemByRouteKey(routeKey)?.routePath ?? null;
}

/** Lista filtrada: solo las apps visibles en menus y en el hub. */
export const VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.visibleInMenus);

/** Apps utilizables sin cuenta (modo libre). */
export const FREE_ACCESS_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.freeAccess);

/** Apps que requieren cuenta (se muestran con invitación a registrarse). */
export const ACCOUNT_ONLY_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => !app.freeAccess);

/** Apps de la familia CADMA (columna izquierda del hub). */
export const CADMA_GROUP_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.group === 'cadma');

/** Apps que no pertenecen a CADMA (columna derecha del hub). */
export const OTHER_GROUP_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.group === 'others');

/** Apps remotas PoC ejecutadas en servidores externos (tercera columna del hub). */
export const SERVER_GROUP_APP_ROUTE_ITEMS: ReadonlyArray<ScientificAppRouteItem> =
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((app) => app.group === 'server');

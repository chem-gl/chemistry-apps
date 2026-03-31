// scientific-apps.config.spec.ts: Pruebas unitarias para la configuración de apps científicas.
// Verifica consistencia de rutas, visibilidad y estructura base del catálogo.

import { describe, expect, it } from 'vitest';
import {
  SCIENTIFIC_APP_ROUTE_ITEMS,
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS,
} from './scientific-apps.config';

describe('scientific-apps.config', () => {
  it('exposes route items with deterministic routePath and available=true', () => {
    for (const appRouteItem of SCIENTIFIC_APP_ROUTE_ITEMS) {
      expect(appRouteItem.routePath).toBe(`/${appRouteItem.key}`);
      expect(appRouteItem.available).toBe(true);
      expect(appRouteItem.title.length).toBeGreaterThan(0);
      expect(appRouteItem.description.length).toBeGreaterThan(0);
    }
  });

  it('filters visible apps correctly for hub/menu usage', () => {
    const expectedVisibleKeys = SCIENTIFIC_APP_ROUTE_ITEMS.filter(
      (appRouteItem) => appRouteItem.visibleInMenus,
    ).map((appRouteItem) => appRouteItem.key);

    const actualVisibleKeys = VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.map(
      (appRouteItem) => appRouteItem.key,
    );

    expect(actualVisibleKeys).toEqual(expectedVisibleKeys);
    expect(actualVisibleKeys).not.toContain('calculator');
    expect(actualVisibleKeys).not.toContain('random-numbers');
  });

  it('keeps route keys unique to avoid menu/router collisions', () => {
    const allKeys = SCIENTIFIC_APP_ROUTE_ITEMS.map((appRouteItem) => appRouteItem.key);
    const uniqueKeys = new Set(allKeys);

    expect(uniqueKeys.size).toBe(allKeys.length);
  });
});

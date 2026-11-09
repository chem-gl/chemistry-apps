# Presupuestos de rendimiento del frontend

Documento vivo de los umbrales de performance/accesibilidad y de **dónde se
aplican hoy**. Reemplaza a `e2e/perf-budget.json` (borrado el 2026-11-08), que
desde Lighthouse 12 no era leído por nadie: el upstream **eliminó los
performance budgets** en la versión 12.0.0 (PR `remove budgets`), el flag
`--budget-path` dejó de existir y yargs lo ignoraba en silencio. Es decir, el
gate nunca existió: era decorativo.

## Decisión de versión de Lighthouse

| Opción | Coste | Riesgo |
|---|---|---|
| Mantener `lighthouse@^12.8.2` y quitar el flag muerto | 0 cambios de lockfile | ninguno (elegida) |
| Bajar a `lighthouse@^11.7.1` (último con `--budget-path`) | 159 paquetes re-instalados, major de ~2 años sin soporte | no mejora nada: `npm audit` da **10 high igualmente** (cadena `puppeteer-core → @puppeteer/browsers/proxy-agent/basic-ftp/get-uri/pac-proxy-agent/extract-zip` + `chromium-bidi → zod`), y `lighthouse` 11.x está dentro del propio rango advisories `9.4.0-dev - 13.3.0` (high) |
| Subir a `lighthouse@^13.6.0` | aclara el advisory de `lighthouse` | exige **node ≥ 22.19**, incompatible con `frontend/Dockerfile` (`node:20-alpine`) → descartada |

`12.8.2` pide `node >= 18.16`, así que convive con la imagen de build.

## Cómo se aplican los umbrales ahora

### 1. Tamaño de bundle — gate automático en el build

`angular.json` → `projects.frontend.architect.build.configurations.production.budgets`:

| Tipo | Warning | Error |
|---|---|---|
| `initial` | 1500 kB | 1000 kB |
| `anyComponentStyle` | 340 kB | 400 kB |

Se verifica en `npx ng build` (y por tanto en el `npm run build` de la imagen
de producción y en CI). Es el heredero real de los antiguos `resourceSizes`.

### 2. Métricas de laboratorio — revisión manual con `npm run audit:perf`

```bash
npm run start          # dev server en 127.0.0.1:4200
npm run audit:perf     # escribe /tmp/opencode/lighthouse-apps.html
```

El reporte sale en HTML con las categorías `performance` y `accessibility`.
Umbrales objetivo (los mismos que estaban en el JSON muerto, ahora como
criterio de revisión; los verás en las métricas del reporte y en la tabla de
"Opportunities"/"Diagnostics"):

| Métrica | Umbral |
|---|---|
| Largest Contentful Paint | ≤ 2500 ms |
| Total Blocking Time | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.1 |
| Interaction to Next Paint | ≤ 200 ms (buena) / > 500 ms (mala) |
| Score Performance | ≥ 90 |
| Score Accessibility | ≥ 90 |

Recursos (informativo, ya no bloqueante): `script` ≤ 400 kB, `stylesheet`
≤ 100 kB, `image` ≤ 500 kB, total ≤ 1600 kB, peticiones totales ≤ 50.

#### Lectura de los números medidos (2026-11-08, LH 12.8.2, desktop)

Con `ng serve` en `127.0.0.1:4200/apps`: performance **0.63**, accessibility
**1.00**, LCP 4966 ms, TBT 0 ms, CLS 0.000013, 55 peticiones / 5.13 MB de
transferencia. **No son una regresión**: el endpoint auditado es el dev server
(sin optimizar, sin hash, sin precompress), así que LCP y el tamaño de red están
fuera de presupuesto por construcción. Los umbrales de arriba tienen sentido
sobre un build de producción servido estático (`ng build` + `nginx.conf`) o con
`ng serve --configuration production`. Si se quiere un gate real, el paso
previo es apuntar `audit:perf` a ese build y asertar desde el JSON, no desde el
HTML.

Lo que sí queda verificado sin intervención: las dimensiones de bundle en
`ng build` (gate de `angular.json`) y, en esta corrida, accessibility = 1.00.

### 3. Accesibilidad y DOM — gate automático en Playwright

`e2e/visual-audit.e2e.spec.ts` (tag `@visual`, `npm run e2e:visual`): axe-core
sin violaciones + presupuestos duros (un solo `h1`, sin overflow horizontal,
sin `<nav>` vacío, sin errores de consola) más screenshots de regresión visual.

## Si se quiere volver a un gate automático de métricas

No se necesita bajar de Lighthouse: basta con pedir también la salida JSON y
asertar los umbrales en un script propio, p. ej.

```bash
npx lighthouse <url> --preset=desktop --only-categories=performance \
  --output=json --output-path=/tmp/opencode/lighthouse-apps.json
# y leer .audits["largest-contentful-paint"].numericValue etc.
```

Queda como mejora pendiente: hoy `audit:perf` es una auditoría local/manual,
no un paso de CI.

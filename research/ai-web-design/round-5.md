---
filename: round-5.md
date: 2026-09-24
---

# ROUND 5 — ESTADO REAL + REFERENCIAS (2026-09-24)

## Branding scrape (firecrawl branding, produccion /apps)
- Esquema light: primary #317154 (verde UAM), secondary/text #0C2021, link #003C71 (azul UNAM), bg #F8FAF9. Radio botones 10px/8px base, sin sombras en CTA.
- Tipografias: Avenir Next (body) + Avenir Next Condensed (headings), fallbacks Liberation/DejaVu. h1 ~16.8px, h2 ~16px en hub (compacto, bien).
- CTA primario verde vibrante Sign in + secundario transparente Create account (confianza 0.95 del analizador). Tono profesional, audiencia academica.
- Contenido hub: 8 apps bloqueadas (Sign in c/u) + Development Team (5) + 4 publicaciones. Sin banner. Estructura sana.

## Auditoria Playwright produccion (1280 + 390)
- hub-d, hub-m, login: 1 h1, nav [Apps, Sign in], 0 navs vacios, 0 overflow (sw==vw), 0 errores JS.
- CTAs hub: [Sign in, Create account]. Login sin .top-actions (correcto).
- Capturas: /tmp/opencode/audit-hub-d.png, audit-hub-m.png, audit-login.png.
- Conclusion: base visual sana; el rediseño pedido es refinamiento, no rescate.

## SCSS repo
- styles.scss: tokens --chem-* completos (UAM greens, UNAM blue/gold, superficies, glass, sombras, tintas, 4 familias tipograficas, estados semanticos, inputs, radios). Sistema maduro.
- apps-hub.component.scss (325 lineas): papel milimetrado + reaction-glow (1 gesto ambiental, resto quieto), barra compacta, lattice con linea quimica ::before, cards 14px radius, locked dashed, reduced-motion OK.
- Riesgo sobrecarga: 70 ficheros SCSS por app; sin auditoria de tokens muertos/duplicados.

## Referencia minimalista (webflow showcase, firecrawl)
- Patrones ganadores: cloneables minimalistas, hero de 1 gesto, MCP 2.0 (clonar + agente IA customiza). Trasladable: tu hub ya sigue ese patron (1 gesto glow); no añadir mas efectos.
- SearXNG flojo en 'scientific dashboard'; mejor inspiracion: NIST WebBook, RDKit docs (pendiente scrapear si se quiere fase 2).

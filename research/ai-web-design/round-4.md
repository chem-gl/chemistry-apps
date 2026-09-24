# ROUND 4 — VERIFY (2026-09-24)
## Claim × 2 fuentes (2025-2026 preferidas)
1. **Playwright+axe es el patrón estándar a11y auto** — Fuente A: playwright.dev/docs/accessibility-testing (oficial, 2026-09-21, AxeBuilder.analyze + include + WCAG 2.1 AA). Fuente B: repo test-automation-best-practices (AxeBuilder + playAudit lighthouse, e2e/tests/a11y.spec.ts) + npm axe-playwright 2.2.2. VERIFICADO. Nota: SearXNG devolvió spam en v1 (ruido, descartado).
2. **Locofy exporta Figma→Angular** — Fuente A: locofy.ai (soporta React, Angular, Vue, Next.js, HTML-CSS, Flutter). Fuente B: locofy.ai/convert/figma-to-angular (flujo plugin). VERIFICADO.
3. **v0 mejor React code-first** — Fuente A: devopsschool comparativa (v0 #1 React+Tailwind). Fuente B: v0.app (genera apps, design mode, deploy Vercel). VERIFICADO con matiz: pricing/límites cambian rápido, validar antes de comprar.
4. **INP ≤200ms Good** — Fuente A: unlighthouse.dev (tabla + reemplazo FID 12-mar-2024). Fuente B: web.dev/Core Web Vitals thresholds (citado dentro). VERIFICADO.
5. **DTCG $value/$type + StyleDict v4** — Fuente A: docs.tokens.studio. Fuente B: styledictionary.com/info/dtcg. VERIFICADO; contradicción parcial: formato 2025.10 aún sin soporte total en SD (trabajo en v5) → no adoptar 2025.10 todavía.
6. **Equipos 2026 usan 2-3 herramientas** — Fuente única (impacttechlab bloqueado por CAPTCHA) + devopsschool (criterios). PARCIAL: marcar como opinión, no hecho duro.

## Contradicciones/flags
- SearXNG mete ruido (spam/irrelevantes) en queries cortas; mitigado con Jina + firecrawl + docs oficiales.
- Sin acceso a papers arXiv (sin tool en entorno) → reportarlo como limitación, no inventar DOIs.

# ROUND 2 — DIVE (2026-09-24)
## Leads profundizados
1. **UI-to-Code IA (top 10)**: v0 Vercel (mejor React+Tailwind code-first), Builder.io Visual Copilot, Locofy.ai (Figma→React/Angular/HTML), Anima, Uizard (wireframe→UI), Framer, TeleportHQ, CodeParrot, Quest AI, Galileo AI. Fuente: devopsschool.com comparativa 2026 (scrape firecrawl). Criterios comprador: calidad código, import Figma/screenshot/prompt, soporte framework (React/Vue/Angular/HTML), Tailwind+design-system mapping, responsive, a11y, export/ownership, Git/CI, colaboración, privacidad, precio escalable.
2. **Playwright a11y oficial**: `@axe-core/playwright` + `AxeBuilder.analyze()`, scan página entera o `.include(selector)`, assertions `violations=[]`, disclaimer: auto solo detecta parte (labels, contraste, IDs duplicados); combinar con manual + Accessibility Insights + WCAG 2.1 AA. Fuente: playwright.dev/docs/accessibility-testing vía Jina (2026-09-21).
3. **Tokens W3C DTCG**: formato `$value/$type/$description`, restricciones `{}$` en nombres; Tokens Studio permite migrar legacy↔DTCG por provider/rama; Style Dictionary v4 soporte DTCG, v5 en progreso (2025.10 parcial); caso Angular 21+Nx (kanso-protocol) emite CSS vars runtime + SCSS + TS. Fuente: docs.tokens.studio + styledictionary.com + designtokens.org.
4. **Equipos 2026**: balance 2-3 herramientas (exploración generativa + gestión DS + handoff/codegen), no una sola.

## Gaps restantes
- Métricas anti-sobrecarga cuantificadas (budgets Lighthouse/CLS/peso).
- Papers académicos IA+UX minimalista.
- Aplicación concreta a chemistry-apps (tokens --chem-*, hub actual).

# ROUND 1 — SCOUT (2026-09-24)
Pregunta: ¿cómo puede la IA mejorar diseños web (chemistry-apps Angular, hub + 7 apps) para que se vea realmente bien sin sobrecarga? Playwright disponible.

## Sub-topics (sequential-thinking #1)
1. Principios minimalismo científico 2025-2026
2. Herramientas IA diseño web/UI
3. Workflow IA+Playwright (screenshots, axe, métricas)
4. Design tokens + CSS moderno sin sobrecarga
5. Anti-patrones sobrecarga

## Hallazgos
- Playwright (Microsoft OSS): screenshots por estado/breakpoint, toHaveScreenshot, nightly diffs; pairing con Storybook; guía aidesign.guide/dictionary/playwright confirma uso diseñadores sin ser ingenieros (fuente: aidesign.guide).
- Visual regression en CI como stage aislado, tags @visual, Docker dedicado (fuente: testquality.com/playwright-visual-regression-guide).
- Stack IA 2026 freelance ES: Cursor IDE (contexto repo) + modelo fuerte (GPT-4o/Claude) para diffs + Copilot solo si VS Code; un editor que ve repo evita alucinaciones (fuente: adrianpozo.es 2026).
- SearXNG flojo en queries genéricas; hace falta inglés técnico + firecrawl para JS-heavy.

## Gaps
- Falta: comparativa herramientas visuales IA (Galileo, Uizard, Locofy, v0, Visily) con precios/límites.
- Falta: métricas objetivas (CLS, axe, contraste, Lighthouse) + presupuestos.
- Falta: papers/académico sobre IA + UX minimalista.
- Falta: cómo aplicar a chemistry-apps sin reescribir (tokens --chem-*, SCSS existente).

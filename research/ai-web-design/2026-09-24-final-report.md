# IA para diseno web sin sobrecarga + estado real chemistry-apps

**Date:** 2026-09-24
**Rounds:** 5

## Executive Summary

La IA rinde como critico visual con Playwright (screenshots + axe + budgets INP), no como generador a ciegas. El estado real de apps-libres esta sano (1 h1, nav OK, 0 overflow, 0 errores, branding UAM-UNAM coherente). Plan de 4 fases: inventario tokens, spec @visual, variantes acotadas con 1 herramienta (v0 o Locofy para Angular), y DTCG solo si hay dispersion.

## Key Findings

1) Playwright+axe patron estandar (playwright.dev, test-automation-best-practices). 2) UI-to-Code: v0 mejor React, Locofy unico con Angular (locofy.ai/convert/figma-to-angular). 3) INP <=200ms good, TBT 30% Lighthouse, 47% webs pasan CWV. 4) DTCG $value/$type, StyleDict v4 emite CSS+SCSS+TS; no 2025.10. 5) Branding prod: #317154/#0C2021/#003C71/#F8FAF9, Avenir Next, radio 10px, 1 gesto ambiental (glow). 6) Auditoria viva: hub-d/hub-m/login sin fallos. 7) Riesgo: 70 SCSS sin auditoria de tokens muertos.

## Sources

https://playwright.dev/docs/accessibility-testing | https://testquality.com/playwright-visual-regression-guide/ | https://www.aidesign.guide/dictionary/playwright | https://www.devopsschool.com/blog/top-10-ai-ui-to-code-generators-features-pros-cons-comparison/ | https://v0.app/ | https://www.locofy.ai/ | https://www.locofy.ai/convert/figma-to-angular | https://docs.tokens.studio/manage-settings/token-format | https://styledictionary.com/info/dtcg/ | https://www.designtokens.org/ | https://unlighthouse.dev/learn-lighthouse/inp | https://www.uxpin.com/studio/blog/cognitive-psychology-for-ux-design/ | https://perspective.orange-business.com/en/cognitive-load-dashboard/ | https://webflow.com/made-in-webflow/minimalist | scrape propio https://apps-libres.guzman-lopez.com/apps

## Conclusions

Arrancar Fase 1 (spec @visual + budgets) sobre la base sana actual; Fase 2 solo 2 piezas (.top-actions, app-card) con 1 herramienta generativa y reescritura manual; Fase 3 DTCG condicional. Delegar a code-refactor/ui-tester/accessibility. Limitaciones: sin arXiv (sin DOIs), SearXNG ruidoso, tesis 2-3 herramientas como opinion.

---
*Full notes: research/ai-web-design/index.md*
// browser-coverage.ts: Captura cobertura V8 del navegador durante pruebas Playwright.
// Se activa solo para el flujo de Sonar y escribe artefactos raw que luego se convierten a lcov.

import type { CDPSession, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface BrowserCoverageState {
  label: string;
  session: CDPSession;
  scriptUrls: Map<string, string>;
}

const COVERAGE_STATE = new WeakMap<Page, BrowserCoverageState>();
const SHOULD_COLLECT_BROWSER_COVERAGE = process.env['PLAYWRIGHT_COLLECT_COVERAGE'] === '1';
const RAW_COVERAGE_DIRECTORY = path.resolve(process.cwd(), 'coverage/e2e/raw');

function sanitizeCoverageLabel(label: string): string {
  let sanitized = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  while (sanitized.startsWith('-')) {
    sanitized = sanitized.slice(1);
  }
  while (sanitized.endsWith('-')) {
    sanitized = sanitized.slice(0, -1);
  }
  return sanitized;
}

export async function startBrowserCoverage(page: Page, label: string): Promise<boolean> {
  if (!SHOULD_COLLECT_BROWSER_COVERAGE) {
    return false;
  }

  const browser = page.context().browser();
  if (browser?.browserType().name() !== 'chromium') {
    return false;
  }

  const session = await page.context().newCDPSession(page);
  const scriptUrls = new Map<string, string>();

  session.on('Debugger.scriptParsed', (event: { scriptId: string; url?: string }) => {
    scriptUrls.set(event.scriptId, event.url ?? '');
  });

  await session.send('Debugger.enable');
  await session.send('Debugger.setSkipAllPauses', { skip: true });
  await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true,
  });

  COVERAGE_STATE.set(page, {
    label,
    session,
    scriptUrls,
  });

  return true;
}

export async function stopBrowserCoverage(page: Page, fallbackLabel: string): Promise<void> {
  const state = COVERAGE_STATE.get(page);
  if (state === undefined) {
    return;
  }

  const coverageResponse = await state.session.send('Profiler.takePreciseCoverage');
  await state.session.send('Profiler.stopPreciseCoverage');
  await state.session.send('Profiler.disable');
  await state.session.send('Debugger.disable');

  const coverageEntries = await Promise.all(
    coverageResponse.result.map(
      async (entry: { scriptId: string; url?: string; functions: unknown[] }) => {
        const scriptSourceResponse = await state.session
          .send('Debugger.getScriptSource', { scriptId: entry.scriptId })
          .catch(() => ({ scriptSource: '' }));

        return {
          ...entry,
          url: entry.url ?? state.scriptUrls.get(entry.scriptId) ?? '',
          source: scriptSourceResponse.scriptSource ?? '',
        };
      },
    ),
  );

  const relevantEntries = coverageEntries.filter((entry) => {
    return entry.url.includes('127.0.0.1:4200') || entry.url.includes('localhost:4200');
  });

  if (relevantEntries.length > 0) {
    await mkdir(RAW_COVERAGE_DIRECTORY, { recursive: true });
    const coverageLabel = sanitizeCoverageLabel(state.label || fallbackLabel || 'playwright-test');
    const outputFilePath = path.join(RAW_COVERAGE_DIRECTORY, `${coverageLabel}-${Date.now()}.json`);
    await writeFile(outputFilePath, JSON.stringify(relevantEntries, null, 2), 'utf8');
  }

  COVERAGE_STATE.delete(page);
}

// playwright-sonar-coverage.mjs: Ejecuta las pruebas E2E con cobertura V8 del navegador.
// Convierte la cobertura raw de Playwright a lcov para que Sonar pueda sumarla al reporte frontend.

import MCR from 'monocart-coverage-reports';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const FRONTEND_ROOT = process.cwd();
const E2E_COVERAGE_DIRECTORY = path.resolve(FRONTEND_ROOT, 'coverage/e2e');
const E2E_RAW_COVERAGE_DIRECTORY = path.resolve(E2E_COVERAGE_DIRECTORY, 'raw');

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: FRONTEND_ROOT,
      env,
      stdio: 'inherit',
    });

    childProcess.on('exit', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`El comando ${command} finalizó con código ${exitCode ?? 'desconocido'}.`));
    });
  });
}

async function loadRawCoverageEntries() {
  const coverageFiles = await readdir(E2E_RAW_COVERAGE_DIRECTORY);
  const coveragePayloads = await Promise.all(
    coverageFiles
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        const filePath = path.join(E2E_RAW_COVERAGE_DIRECTORY, fileName);
        const fileContent = await readFile(filePath, 'utf8');
        return JSON.parse(fileContent);
      }),
  );

  return coveragePayloads.flat();
}

async function generateLcovReport() {
  const rawCoverageEntries = await loadRawCoverageEntries();
  if (rawCoverageEntries.length === 0) {
    throw new Error('No se generó cobertura raw de Playwright para Sonar.');
  }

  const coverageReport = MCR({
    name: 'Chemistry Apps frontend e2e coverage',
    outputDir: E2E_COVERAGE_DIRECTORY,
    cleanCache: true,
    reports: ['lcovonly'],
    entryFilter: (entry) =>
      entry.url.includes('127.0.0.1:4200') || entry.url.includes('localhost:4200'),
    sourceFilter: (sourcePath) => {
      const normalizedSourcePath = sourcePath.replaceAll('\\', '/');
      return (
        (normalizedSourcePath.includes('/frontend/src/') ||
          normalizedSourcePath.startsWith('src/') ||
          normalizedSourcePath.includes('/src/')) &&
        !normalizedSourcePath.endsWith('.spec.ts')
      );
    },
  });

  await coverageReport.add(rawCoverageEntries);
  await coverageReport.generate();
}

async function main() {
  await rm(E2E_COVERAGE_DIRECTORY, { force: true, recursive: true });
  await mkdir(E2E_RAW_COVERAGE_DIRECTORY, { recursive: true });

  const nodeExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await runCommand(nodeExecutable, ['playwright', 'test', 'e2e/identity-groups.e2e.spec.ts'], {
    ...process.env,
    PLAYWRIGHT_COLLECT_COVERAGE: '1',
  });

  await generateLcovReport();
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

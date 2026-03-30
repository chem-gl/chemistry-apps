// convert_frontend_coverage_to_sonar.mjs: Convierte coverage-final.json de Vitest/Istanbul a XML genérico compatible con Sonar.
// Se usa desde la automatización de reportes para importar cobertura frontend cuando Angular no emite lcov por CLI.

import fs from "node:fs";
import path from "node:path";

const [, , inputPath, outputPath, repoRootArgument] = process.argv;

if (!inputPath || !outputPath) {
  console.error(
    "Uso: node scripts/convert_frontend_coverage_to_sonar.mjs <coverage-final.json> <salida.xml> [repoRoot]",
  );
  process.exit(1);
}

const repoRoot = path.resolve(
  repoRootArgument ?? path.join(path.dirname(inputPath), "..", "..", ".."),
);
const absoluteInputPath = path.resolve(inputPath);
const absoluteOutputPath = path.resolve(outputPath);

const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const addLineCoverage = (lineCoverageMap, lineNumber, nextCovered) => {
  const currentCoverage = lineCoverageMap.get(lineNumber) ?? {
    covered: false,
    branchesToCover: 0,
    coveredBranches: 0,
  };

  currentCoverage.covered = currentCoverage.covered || nextCovered;
  lineCoverageMap.set(lineNumber, currentCoverage);
};

const addBranchCoverage = (
  lineCoverageMap,
  lineNumber,
  branchesToCover,
  coveredBranches,
) => {
  const currentCoverage = lineCoverageMap.get(lineNumber) ?? {
    covered: false,
    branchesToCover: 0,
    coveredBranches: 0,
  };

  currentCoverage.branchesToCover += branchesToCover;
  currentCoverage.coveredBranches += coveredBranches;
  lineCoverageMap.set(lineNumber, currentCoverage);
};

const expandLineRange = (startLine, endLine) => {
  const lineNumbers = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    lineNumbers.push(lineNumber);
  }
  return lineNumbers;
};

const coverageReport = JSON.parse(fs.readFileSync(absoluteInputPath, "utf8"));
const outputLines = ['<coverage version="1">'];

for (const [absoluteFilePath, fileCoverage] of Object.entries(coverageReport)) {
  const relativeFilePath = path
    .relative(repoRoot, absoluteFilePath)
    .split(path.sep)
    .join("/");
  const lineCoverageMap = new Map();

  for (const [statementId, statementLocation] of Object.entries(
    fileCoverage.statementMap,
  )) {
    const hitCount = (fileCoverage.s?.[statementId] ?? 0) > 0;
    const coveredLines = expandLineRange(
      statementLocation.start.line,
      statementLocation.end.line,
    );
    for (const lineNumber of coveredLines) {
      addLineCoverage(lineCoverageMap, lineNumber, hitCount);
    }
  }

  for (const [branchId, branchLocation] of Object.entries(
    fileCoverage.branchMap,
  )) {
    const branchCounts = fileCoverage.b?.[branchId] ?? [];
    const branchLineNumber =
      branchLocation.line ?? branchLocation.loc?.start.line;
    if (typeof branchLineNumber !== "number") {
      continue;
    }

    addBranchCoverage(
      lineCoverageMap,
      branchLineNumber,
      branchCounts.length,
      branchCounts.filter((count) => count > 0).length,
    );
  }

  outputLines.push(`  <file path="${xmlEscape(relativeFilePath)}">`);
  for (const [lineNumber, lineCoverage] of [...lineCoverageMap.entries()].sort(
    ([leftLine], [rightLine]) => leftLine - rightLine,
  )) {
    const branchAttributes =
      lineCoverage.branchesToCover > 0
        ? ` branchesToCover="${lineCoverage.branchesToCover}" coveredBranches="${lineCoverage.coveredBranches}"`
        : "";
    outputLines.push(
      `    <lineToCover lineNumber="${lineNumber}" covered="${lineCoverage.covered}"${branchAttributes} />`,
    );
  }
  outputLines.push("  </file>");
}

outputLines.push("</coverage>");

fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
fs.writeFileSync(absoluteOutputPath, `${outputLines.join("\n")}\n`, "utf8");

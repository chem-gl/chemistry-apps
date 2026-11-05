#!/usr/bin/env python3
"""normalize_coverage_xml.py: Adapta el coverage.xml de coverage.py a SonarQube.

Problema que resuelve:
- coverage.py escribe `<source>` con la ruta absoluta del backend y `filename`
  relativa a esa fuente (`apps/core/models.py`).
- Al prefijar `filename="backend/` con sed se rompía la resolución: Sonar unía
  el `<source>` absoluto (`.../backend`) con la ruta ya prefijada
  (`.../backend/backend/apps/...`) y no encontraba ningún archivo, dejando el
  backend al 0 % de cobertura aunque el reporte real fuera 94 %.

Qué hace:
- Elimina el bloque `<sources>` para que Sonar resuelva `filename` contra el
  directorio base del proyecto.
- Deja cada `filename` relativa a la raíz del repositorio (`backend/...`),
  preservando la estructura de paquetes.

Uso:
    python3 scripts/normalize_coverage_xml.py backend/coverage.xml
    python3 scripts/normalize_coverage_xml.py backend/coverage.xml --prefix backend
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path


def _normalize_filename(filename_value: str, prefix: str) -> str:
    """Devuelve la ruta relativa al repositorio con el prefijo pedido una sola vez."""
    normalized = filename_value.replace("\\", "/").lstrip("./")
    if prefix == "" or normalized == f"{prefix}" or normalized.startswith(f"{prefix}/"):
        return normalized
    return f"{prefix}/{normalized}"


def normalize_coverage_xml(
    report_path: Path, prefix: str = "backend"
) -> tuple[int, int]:
    """Reescribe el reporte in-place. Retorna (archivos, líneas normalizadas)."""
    if not report_path.exists():
        raise FileNotFoundError(f"No existe el reporte de cobertura: {report_path}")

    tree = ElementTree.parse(report_path)
    root = tree.getroot()

    # Sin <sources>, Sonar resuelve cada filename contra el base dir del proyecto.
    for sources_node in root.findall("sources"):
        root.remove(sources_node)

    rewritten = 0
    seen_files = 0
    for class_node in root.iter("class"):
        raw_filename = class_node.get("filename", "")
        if raw_filename == "":
            continue
        seen_files += 1
        normalized = _normalize_filename(raw_filename, prefix)
        if normalized != raw_filename:
            class_node.set("filename", normalized)
            rewritten += 1

    tree.write(report_path, encoding="utf-8", xml_declaration=True)
    return seen_files, rewritten


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Normaliza coverage.xml para SonarQube."
    )
    parser.add_argument("report", type=Path, help="Ruta del coverage.xml a normalizar.")
    parser.add_argument(
        "--prefix",
        default="backend",
        help="Prefijo relativo a la raíz del repo (por defecto: backend).",
    )
    arguments = parser.parse_args(argv)

    try:
        total_files, rewritten = normalize_coverage_xml(
            arguments.report, arguments.prefix
        )
    except (FileNotFoundError, ElementTree.ParseError) as error:
        print(f"[normalize_coverage_xml] {error}", file=sys.stderr)
        return 1

    print(
        f"[normalize_coverage_xml] {arguments.report}: "
        f"{total_files} clases, {rewritten} rutas reescritas, <sources> eliminado."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

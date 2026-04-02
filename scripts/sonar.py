"""sonar.py: Orquestador principal del reporte de SonarQube.

Objetivo: componer el reporte final de issues, duplicaciones y hotspots
importando la logica desde _sonar_config, _sonar_duplication y _sonar_hotspots.
Uso: python scripts/sonar.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Asegura que el directorio scripts/ este en sys.path para imports absolutos
_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from _sonar_config import (  # noqa: E402
    OUTPUT_FILE,
    PROJECT_KEY,
    SONAR_TOKEN,  # noqa: F401  # importado para forzar validacion de configuracion al inicio
    SONAR_URL,
    get_rule_description,
    sonar_get,
)
from _sonar_duplication import get_sonar_duplicate_code_section  # noqa: E402
from _sonar_hotspots import get_sonar_security_hotspots_section  # noqa: E402


def get_all_issues() -> list[dict]:
    """Obtiene todos los issues abiertos del proyecto desde SonarQube (paginado)."""
    issues: list[dict] = []
    page: int = 1
    page_size: int = 500

    while True:
        response = sonar_get(
            "/api/issues/search",
            {
                "componentKeys": PROJECT_KEY,
                "ps": page_size,
                "p": page,
                "resolved": "false",
            },
        )
        if response.status_code != 200:
            print("Error al obtener issues")
            break
        data = response.json()
        batch: list[dict] = data.get("issues", [])
        if not batch:
            break
        issues.extend(batch)
        page += 1

    return issues


def _format_issue_block(index: int, issue: dict) -> str:
    """Construye el bloque de texto para un issue individual."""
    archivo: str = issue.get("component", "N/A")
    problema: str = issue.get("message", "N/A")
    regla: str = issue.get("rule", "N/A")
    severidad: str = issue.get("severity", "N/A")
    tipo: str = issue.get("type", "N/A")
    linea: int | None = issue.get("line")
    descripcion_regla: str = get_rule_description(regla)
    linea_str = str(linea) if linea else "N/A"
    parts = [
        f"Problema {index}",
        f"Archivo: {archivo}",
        "",
        "Problema:",
        problema,
        "",
        "Razón:",
        f"Tipo: {tipo}",
        f"Regla: {regla}",
        f"Severidad: {severidad}",
        f"Línea: {linea_str}",
        "",
        "Cómo solucionarlo:",
        descripcion_regla,
        "",
        "----------------------------------------",
    ]
    return "\n".join(parts)


def generate_report(issues: list[dict]) -> str:
    """Compone el reporte completo: issues + duplicaciones + hotspots."""
    lines: list[str] = [
        _format_issue_block(index, issue) for index, issue in enumerate(issues, start=1)
    ]
    duplicate_section = get_sonar_duplicate_code_section()
    if duplicate_section:
        lines.append(duplicate_section)
    hotspots_section = get_sonar_security_hotspots_section()
    if hotspots_section:
        lines.append(hotspots_section)
    return "\n\n".join(lines)


def main() -> None:
    """Punto de entrada: genera el reporte y lo escribe en el archivo de salida."""
    print(f"Proyecto: {PROJECT_KEY} | Servidor: {SONAR_URL}")
    print("Obteniendo issues de Sonar...")
    issues: list[dict] = get_all_issues()
    print(f"Total issues encontrados: {len(issues)}")
    report: str = generate_report(issues)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Reporte generado en: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

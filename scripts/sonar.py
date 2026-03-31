import re

import requests

# =========================
# CONFIGURACIÓN
# =========================
SONAR_URL = "http://localhost:9000"
SONAR_TOKEN = "sqp_bb9823a9a8ba378ce35b2cda061b5f1c158cb543"
PROJECT_KEY = "chemistry-apps"
OUTPUT_FILE = "sonar_report.txt"
# =========================
# CACHE DE REGLAS
# =========================
rules_cache: dict[str, str] = {}


# =========================
# OBTENER DOCUMENTACIÓN DE REGLA
# =========================
def _extract_description_from_sections(sections: list[dict]) -> str:
    """Extrae el texto de las secciones de descripción, priorizando 'how_to_fix'."""
    # Orden de preferencia: cómo solucionarlo → causa → cualquier otra
    priority_order = ["how_to_fix", "root_cause"]
    sections_by_key = {s.get("key", ""): s.get("content", "") for s in sections}

    for key in priority_order:
        if key in sections_by_key and sections_by_key[key].strip():
            return sections_by_key[key]

    # Fallback: primera sección disponible
    for section in sections:
        content = section.get("content", "").strip()
        if content:
            return content

    return ""


def get_rule_description(rule_key: str) -> str:
    if rule_key in rules_cache:
        return rules_cache[rule_key]

    response = requests.get(
        f"{SONAR_URL}/api/rules/show", params={"key": rule_key}, auth=(SONAR_TOKEN, "")
    )

    if response.status_code != 200:
        return "No se pudo obtener la documentación"

    data = response.json()
    rule = data.get("rule", {})

    # SonarQube 10.x usa descriptionSections; versiones anteriores usan htmlDesc
    sections: list[dict] = rule.get("descriptionSections", [])
    raw_html: str = (
        _extract_description_from_sections(sections)
        if sections
        else rule.get("htmlDesc", "")
    )

    if not raw_html:
        rules_cache[rule_key] = "Sin documentación disponible"
        return "Sin documentación disponible"

    # Limpiar etiquetas HTML y espacios extra
    clean = re.sub(r"<[^>]+>", "", raw_html)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()

    rules_cache[rule_key] = clean
    return clean


# =========================
# OBTENER ISSUES
# =========================
def get_all_issues() -> list[dict]:
    issues: list[dict] = []
    page: int = 1
    page_size: int = 500

    while True:
        response = requests.get(
            f"{SONAR_URL}/api/issues/search",
            params={"componentKeys": PROJECT_KEY, "ps": page_size, "p": page},
            auth=(SONAR_TOKEN, ""),
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


# =========================
# GENERAR REPORTE
# =========================
def generate_report(issues: list[dict]) -> str:
    lines: list[str] = []

    for index, issue in enumerate(issues, start=1):
        archivo: str = issue.get("component", "N/A")
        problema: str = issue.get("message", "N/A")
        regla: str = issue.get("rule", "N/A")
        severidad: str = issue.get("severity", "N/A")
        tipo: str = issue.get("type", "N/A")
        linea: int | None = issue.get("line")

        descripcion_regla: str = get_rule_description(regla)

        bloque: str = f"""
Problema {index}
Archivo: {archivo}

Problema:
{problema}

Razón:
Tipo: {tipo}
Regla: {regla}
Severidad: {severidad}
Línea: {linea if linea else "N/A"}

Cómo solucionarlo:
{descripcion_regla}

----------------------------------------
"""
        lines.append(bloque.strip())

    return "\n\n".join(lines)


# =========================
# MAIN
# =========================
def main() -> None:
    print("Obteniendo issues de Sonar...")
    issues: list[dict] = get_all_issues()

    print(f"Total issues encontrados: {len(issues)}")

    report: str = generate_report(issues)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"Reporte generado en: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

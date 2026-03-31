import os
import re
from pathlib import Path

import requests


# primero se ejecuta generate_sonar_report.py para generar el reporte de SonarQube, luego se ejecuta generate_gpt_report.py para generar el reporte final con explicaciones de cada issue.
def _load_sonar_properties(properties_file_path: Path) -> dict[str, str]:
    """Carga pares clave=valor desde sonar-project.properties."""
    if not properties_file_path.exists():
        return {}

    parsed_properties: dict[str, str] = {}
    with properties_file_path.open("r", encoding="utf-8") as properties_file:
        for raw_line in properties_file:
            stripped_line: str = raw_line.strip()
            if stripped_line == "" or stripped_line.startswith("#"):
                continue
            if "=" not in stripped_line:
                continue
            key, value = stripped_line.split("=", 1)
            parsed_properties[key.strip()] = value.strip()
    return parsed_properties


_ENV_REFERENCE_PATTERN = re.compile(r"\$\{env\.([A-Za-z_]\w*)\}")


def _resolve_property_value(raw_value: str, environment: dict[str, str]) -> str:
    """Resuelve valores ${env.VAR} y retorna cadena final limpia."""
    if raw_value == "":
        return ""

    matched_reference = _ENV_REFERENCE_PATTERN.fullmatch(raw_value)
    if matched_reference is None:
        return raw_value

    referenced_env_var: str = matched_reference.group(1)
    return environment.get(referenced_env_var, "").strip()


# =========================
# CARGA DE .env
# =========================
def _load_env_file(env_file_path: Path) -> None:
    """Carga variables del .env en os.environ si no están ya definidas en el entorno."""
    if not env_file_path.exists():
        return
    for key, value in _load_sonar_properties(env_file_path).items():
        if key and key not in os.environ:
            os.environ[key] = value


# =========================
# CONFIGURACIÓN
# =========================
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
_load_env_file(REPOSITORY_ROOT / ".env")
SONAR_PROPERTIES_PATH = REPOSITORY_ROOT / "sonar-project.properties"
SONAR_PROPERTIES = _load_sonar_properties(SONAR_PROPERTIES_PATH)

SONAR_URL = (
    os.environ.get("SONAR_URL", "").strip()
    or _resolve_property_value(
        SONAR_PROPERTIES.get("sonar.host.url", ""),
        os.environ,
    )
    or "http://localhost:9000"  # http se acepta para desarrollo local; no se expone a internet
)
SONAR_TOKEN = os.environ.get("SONAR_TOKEN", "").strip() or _resolve_property_value(
    SONAR_PROPERTIES.get("sonar.token", ""),
    os.environ,
)
PROJECT_KEY = (
    os.environ.get("SONAR_PROJECT_KEY", "").strip()
    or _resolve_property_value(
        SONAR_PROPERTIES.get("sonar.projectKey", ""),
        os.environ,
    )
    or "chemistry-apps"
)
OUTPUT_FILE = str(REPOSITORY_ROOT / "sonar_report.txt")

if not SONAR_TOKEN:
    raise RuntimeError(
        "No se encontró token de SonarQube. "
        "Defínelo en variable de entorno SONAR_TOKEN o en sonar-project.properties "
        "como sonar.token=${env.SONAR_TOKEN}."
    )
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


def _sonar_get(path: str, params: dict[str, str | int]) -> requests.Response:
    """Ejecuta una petición GET autenticada contra SonarQube."""
    return requests.get(
        f"{SONAR_URL}{path}",
        params=params,
        auth=(SONAR_TOKEN, ""),
        timeout=30,
    )


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
            params={
                "componentKeys": PROJECT_KEY,
                "ps": page_size,
                "p": page,
                "resolved": "false",  # solo issues abiertos (no resueltos ni cerrados)
            },
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


def _format_issue_block(index: int, issue: dict) -> str:
    """Construye el bloque de texto para un issue individual."""
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
    return bloque.strip()


def _parse_duplication_measures(component: dict) -> tuple[float, float]:
    """Extrae duplicated_blocks y duplicated_lines de un componente de Sonar."""
    measures = {
        metric.get("metric", ""): metric.get("value", "0")
        for metric in component.get("measures", [])
    }
    duplicated_blocks = float(measures.get("duplicated_blocks", "0") or "0")
    duplicated_lines = float(measures.get("duplicated_lines", "0") or "0")
    return duplicated_blocks, duplicated_lines


def _build_duplication_file_entry(
    component: dict, duplicated_blocks: float, duplicated_lines: float
) -> dict[str, str]:
    """Construye la entrada serializable para un archivo con duplicación."""
    return {
        "key": component.get("key", ""),
        "name": component.get("name", ""),
        "path": component.get("path", component.get("key", "")),
        "duplicated_blocks": str(int(duplicated_blocks)),
        "duplicated_lines": str(int(duplicated_lines)),
    }


def _get_project_duplication_summary() -> dict[str, str]:
    """Obtiene las métricas de duplicación del proyecto desde Sonar."""
    response = _sonar_get(
        "/api/measures/component",
        {
            "component": PROJECT_KEY,
            "metricKeys": "duplicated_blocks,duplicated_lines,duplicated_lines_density",
        },
    )

    if response.status_code != 200:
        return {}

    component = response.json().get("component", {})
    measures = {
        metric.get("metric", ""): metric.get("value", "0")
        for metric in component.get("measures", [])
    }
    return {
        "duplicated_blocks": measures.get("duplicated_blocks", "0") or "0",
        "duplicated_lines": measures.get("duplicated_lines", "0") or "0",
        "duplicated_lines_density": measures.get("duplicated_lines_density", "0")
        or "0",
    }


def _get_project_files_with_duplication() -> list[dict[str, str]]:
    """Obtiene desde Sonar los archivos con bloques/líneas duplicadas en el proyecto."""
    duplicated_files: list[dict[str, str]] = []
    page: int = 1
    page_size: int = 500

    while True:
        response = _sonar_get(
            "/api/measures/component_tree",
            {
                "component": PROJECT_KEY,
                "metricKeys": "duplicated_lines,duplicated_blocks",
                "qualifiers": "FIL",
                "ps": page_size,
                "p": page,
            },
        )

        if response.status_code != 200:
            break

        payload = response.json()
        components: list[dict] = payload.get("components", [])
        if not components:
            break

        for component in components:
            duplicated_blocks, duplicated_lines = _parse_duplication_measures(component)
            if duplicated_blocks <= 0 and duplicated_lines <= 0:
                continue
            duplicated_files.append(
                _build_duplication_file_entry(
                    component, duplicated_blocks, duplicated_lines
                )
            )

        paging = payload.get("paging", {})
        total = int(paging.get("total", 0) or 0)
        if page * page_size >= total:
            break
        page += 1

    return duplicated_files


def _resolve_duplication_block_file(
    current_file_key: str,
    files_payload: list[dict],
    block: dict,
) -> str:
    """Resuelve el archivo asociado a un bloque de duplicación devuelto por Sonar."""
    ref = block.get("_ref")
    if isinstance(ref, int) and 0 <= ref < len(files_payload):
        referenced = files_payload[ref]
        return referenced.get("key", referenced.get("name", current_file_key))
    if isinstance(ref, str):
        for file_info in files_payload:
            if file_info.get("uuid") == ref:
                return file_info.get("key", file_info.get("name", current_file_key))
    return current_file_key


def _get_sonar_duplicate_code_section() -> str:
    """Construye una sección de reporte con duplicaciones reales obtenidas desde Sonar."""
    duplicated_files = _get_project_files_with_duplication()
    project_summary = _get_project_duplication_summary()

    section_lines: list[str] = []
    section_lines.append("=== Código duplicado (SonarQube) ===")
    if project_summary:
        section_lines.append(
            "Resumen del proyecto: "
            f"bloques={project_summary.get('duplicated_blocks', '0')} | "
            f"líneas={project_summary.get('duplicated_lines', '0')} | "
            f"densidad={project_summary.get('duplicated_lines_density', '0')}%"
        )
    else:
        section_lines.append("Resumen del proyecto: no disponible desde Sonar.")

    if not duplicated_files:
        section_lines.append(
            "No se encontraron archivos con duplicación visible en la respuesta de Sonar."
        )
        return "\n".join(section_lines).strip()

    for duplicated_file in duplicated_files:
        file_key = duplicated_file.get("key", "")
        file_path = duplicated_file.get("path", file_key)
        duplicated_blocks = duplicated_file.get("duplicated_blocks", "0")
        duplicated_lines = duplicated_file.get("duplicated_lines", "0")
        section_lines.append("")
        section_lines.append(f"Archivo: {file_path}")
        section_lines.append(
            f"Duplicated blocks: {duplicated_blocks} | Duplicated lines: {duplicated_lines}"
        )

        if not file_key:
            section_lines.append("  No se pudo resolver la clave del archivo en Sonar.")
            continue

        response = _sonar_get("/api/duplications/show", {"key": file_key})
        if response.status_code != 200:
            section_lines.append(
                "  No se pudieron obtener detalles de duplicación para este archivo."
            )
            continue

        data = response.json()
        duplications: list[dict] = data.get("duplications", [])
        files_payload: list[dict] = data.get("files", [])

        if not duplications:
            section_lines.append(
                "  Sonar reporta duplicación, pero no devolvió bloques detallados."
            )
            continue

        for duplication in duplications:
            blocks: list[dict] = duplication.get("blocks", [])
            for block in blocks:
                origin_file = _resolve_duplication_block_file(
                    file_key, files_payload, block
                )
                start_line = block.get("from", "N/A")
                end_line = block.get("to", block.get("from", "N/A"))
                size = block.get("size", "N/A")
                section_lines.append(
                    f"  - {origin_file} | líneas {start_line}-{end_line} | tamaño {size}"
                )

        section_lines.append("----------------------------------------")

    return "\n".join(section_lines).strip()


# =========================
# GENERAR REPORTE
# =========================
def generate_report(issues: list[dict]) -> str:
    lines: list[str] = [
        _format_issue_block(index, issue) for index, issue in enumerate(issues, start=1)
    ]

    duplicate_section = _get_sonar_duplicate_code_section()
    if duplicate_section:
        lines.append(duplicate_section)

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

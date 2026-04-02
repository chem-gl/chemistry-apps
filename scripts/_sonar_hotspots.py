"""_sonar_hotspots.py: Obtiene y formatea security hotspots de SonarQube.

Objetivo: construir la sección de hotspots del reporte consultando
la API de SonarQube y etiquetando probabilidad y estado de cada uno.
Usado por sonar.py en la composición del reporte final.
"""

from __future__ import annotations

from _sonar_config import PROJECT_KEY, get_rule_description, sonar_get

# Mapa de etiqueta de probabilidad de vulnerabilidad por valor de Sonar
_HOTSPOT_PROBABILITY_LABEL: dict[str, str] = {
    "HIGH": "Alta",
    "MEDIUM": "Media",
    "LOW": "Baja",
}


def _get_all_hotspots() -> list[dict]:
    """Obtiene todos los security hotspots del proyecto desde Sonar (paginado)."""
    hotspots: list[dict] = []
    page: int = 1
    page_size: int = 500

    while True:
        response = sonar_get(
            "/api/hotspots/search",
            {"projectKey": PROJECT_KEY, "ps": page_size, "p": page},
        )
        if response.status_code != 200:
            break
        payload = response.json()
        batch: list[dict] = payload.get("hotspots", [])
        if not batch:
            break
        hotspots.extend(batch)

        paging = payload.get("paging", {})
        total = int(paging.get("total", 0) or 0)
        if page * page_size >= total:
            break
        page += 1

    return hotspots


def _format_hotspot_entry(hotspot: dict) -> str:
    """Formatea un hotspot de seguridad en una cadena legible para el reporte."""
    rule_key: str = hotspot.get("ruleKey", "") or hotspot.get("securityCategory", "")
    description: str = get_rule_description(rule_key) if rule_key else ""

    probability_raw: str = hotspot.get("vulnerabilityProbability", "")
    probability: str = _HOTSPOT_PROBABILITY_LABEL.get(probability_raw, probability_raw)

    component: str = hotspot.get("component", "")
    line: int | str = hotspot.get("line", "N/A")
    status: str = hotspot.get("status", "")

    lines: list[str] = [
        "",
        f"Archivo: {component}",
        f"Línea: {line}",
        f"Regla: {rule_key}",
        f"Probabilidad: {probability}",
        f"Estado: {status}",
    ]
    if description:
        lines.append(f"Descripción: {description}")

    message: str = hotspot.get("message", "")
    if message:
        lines.append(f"Mensaje: {message}")

    lines.append("----------------------------------------")
    return "\n".join(lines)


def get_sonar_security_hotspots_section() -> str:
    """Construye la sección de hotspots del reporte desde la API de Sonar."""
    hotspots = _get_all_hotspots()
    if not hotspots:
        return "=== Security Hotspots (SonarQube) ===\nNo se encontraron hotspots."

    section_lines: list[str] = [
        "=== Security Hotspots (SonarQube) ===",
        f"Total: {len(hotspots)} hotspot(s) encontrado(s).",
    ]
    section_lines.extend(_format_hotspot_entry(h) for h in hotspots)
    return "\n".join(section_lines).strip()

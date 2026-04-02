"""_sonar_config.py: Configuración, cliente HTTP y caché de reglas para SonarQube.

Objetivo: centralizar carga de credenciales, configuración de URLs,
cliente HTTP autenticado y documentación de reglas en memoria.
Usado por todos los módulos _sonar_*.py.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import requests

# =========================
# CARGA DE PROPIEDADES
# =========================

_ENV_REFERENCE_PATTERN = re.compile(r"\$\{env\.([A-Za-z_]\w*)\}")


def _load_sonar_properties(properties_file_path: Path) -> dict[str, str]:
    """Carga pares clave=valor desde un archivo .properties o .env."""
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


def _resolve_property_value(raw_value: str, environment: dict[str, str]) -> str:
    """Resuelve valores ${env.VAR} y retorna cadena final limpia."""
    if raw_value == "":
        return ""
    matched_reference = _ENV_REFERENCE_PATTERN.fullmatch(raw_value)
    if matched_reference is None:
        return raw_value
    referenced_env_var: str = matched_reference.group(1)
    return environment.get(referenced_env_var, "").strip()


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

REPOSITORY_ROOT: Path = Path(__file__).resolve().parents[1]
_load_env_file(REPOSITORY_ROOT / ".env")

_sonar_props: dict[str, str] = _load_sonar_properties(
    REPOSITORY_ROOT / "sonar-project.properties"
)

SONAR_URL: str = (
    os.environ.get("SONAR_URL", "").strip()
    or _resolve_property_value(_sonar_props.get("sonar.host.url", ""), os.environ)
    or "http://localhost:9000"  # http aceptable en desarrollo local; no expuesto a internet
)
SONAR_TOKEN: str = os.environ.get("SONAR_TOKEN", "").strip() or _resolve_property_value(
    _sonar_props.get("sonar.token", ""), os.environ
)
PROJECT_KEY: str = (
    os.environ.get("SONAR_PROJECT_KEY", "").strip()
    or _resolve_property_value(_sonar_props.get("sonar.projectKey", ""), os.environ)
    or "chemistry-apps"
)
OUTPUT_FILE: str = str(REPOSITORY_ROOT / "sonar_report.txt")
DENSITY_THRESHOLD: float = 3.5

if not SONAR_TOKEN:
    raise RuntimeError(
        "No se encontró token de SonarQube. "
        "Defínelo en variable de entorno SONAR_TOKEN o en sonar-project.properties "
        "como sonar.token=${env.SONAR_TOKEN}."
    )

# =========================
# CLIENTE HTTP
# =========================


def sonar_get(path: str, params: dict[str, str | int]) -> requests.Response:
    """Ejecuta una petición GET autenticada contra SonarQube."""
    return requests.get(
        f"{SONAR_URL}{path}",
        params=params,
        auth=(SONAR_TOKEN, ""),
        timeout=30,
    )


# =========================
# CACHÉ DE REGLAS
# =========================

_rules_cache: dict[str, str] = {}


def _extract_description_from_sections(sections: list[dict]) -> str:
    """Extrae texto de las secciones de descripción, priorizando 'how_to_fix'."""
    priority_order: list[str] = ["how_to_fix", "root_cause"]
    sections_by_key: dict[str, str] = {
        s.get("key", ""): s.get("content", "") for s in sections
    }
    for key in priority_order:
        if key in sections_by_key and sections_by_key[key].strip():
            return sections_by_key[key]
    for section in sections:
        content = section.get("content", "").strip()
        if content:
            return content
    return ""


def get_rule_description(rule_key: str) -> str:
    """Obtiene la descripción de una regla de Sonar con caché en memoria."""
    if rule_key in _rules_cache:
        return _rules_cache[rule_key]

    response = requests.get(
        f"{SONAR_URL}/api/rules/show",
        params={"key": rule_key},
        auth=(SONAR_TOKEN, ""),
    )
    if response.status_code != 200:
        return "No se pudo obtener la documentación"

    data = response.json()
    rule = data.get("rule", {})
    sections: list[dict] = rule.get("descriptionSections", [])
    raw_html: str = (
        _extract_description_from_sections(sections)
        if sections
        else rule.get("htmlDesc", "")
    )
    if not raw_html:
        _rules_cache[rule_key] = "Sin documentación disponible"
        return "Sin documentación disponible"

    clean = re.sub(r"<[^>]+>", "", raw_html)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    _rules_cache[rule_key] = clean
    return clean

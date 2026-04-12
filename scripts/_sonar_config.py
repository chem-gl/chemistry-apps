"""_sonar_config.py: Configuración, cliente HTTP y caché de reglas para SonarQube.

Objetivo: centralizar carga de credenciales, configuración de URLs,
cliente HTTP autenticado y documentación de reglas en memoria.
Usado por todos los módulos _sonar_*.py.
"""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

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


class SonarHttpResponse:
    """Respuesta HTTP mínima compatible con el uso actual del módulo."""

    def __init__(self, status_code: int, body_text: str) -> None:
        self.status_code = status_code
        self._body_text = body_text

    def json(self) -> dict[str, Any]:
        """Parsea el body como JSON y retorna un dict seguro."""
        if self._body_text.strip() == "":
            return {}

        parsed_payload = json.loads(self._body_text)
        return parsed_payload if isinstance(parsed_payload, dict) else {}


def _build_basic_auth_header(token: str) -> str:
    """Construye el header Authorization para token de SonarQube."""
    raw_value = f"{token}:".encode("utf-8")
    encoded_value = base64.b64encode(raw_value).decode("ascii")
    return f"Basic {encoded_value}"


def _compose_url(path: str, params: dict[str, str | int]) -> str:
    """Compone URL absoluta con querystring serializado."""
    encoded_query = urllib_parse.urlencode(params)
    base_url = f"{SONAR_URL}{path}"
    return f"{base_url}?{encoded_query}" if encoded_query else base_url


def sonar_get(path: str, params: dict[str, str | int]) -> SonarHttpResponse:
    """Ejecuta una petición GET autenticada contra SonarQube."""
    request_url = _compose_url(path=path, params=params)
    request_headers = {
        "Accept": "application/json",
        "Authorization": _build_basic_auth_header(SONAR_TOKEN),
    }
    http_request = urllib_request.Request(
        request_url,
        headers=request_headers,
        method="GET",
    )

    try:
        with urllib_request.urlopen(http_request, timeout=30) as http_response:
            response_body = http_response.read().decode("utf-8")
            return SonarHttpResponse(
                status_code=http_response.status, body_text=response_body
            )
    except urllib_error.HTTPError as http_error:
        error_body = http_error.read().decode("utf-8")
        return SonarHttpResponse(status_code=http_error.code, body_text=error_body)
    except urllib_error.URLError:
        return SonarHttpResponse(status_code=0, body_text="")


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

    response = sonar_get("/api/rules/show", {"key": rule_key})
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

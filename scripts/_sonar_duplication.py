"""_sonar_duplication.py: Obtiene y formatea código duplicado de SonarQube.

Objetivo: construir la sección de duplicación del reporte consultando
la API de SonarQube y detallando bloques y archivos duplicados.
Usado por sonar.py en la composición del reporte final.
"""

from __future__ import annotations

from _sonar_config import DENSITY_THRESHOLD, PROJECT_KEY, sonar_get

# =========================
# OBTENER MÉTRICAS DE DUPLICACIÓN
# =========================


def _parse_duplication_measures(component: dict) -> tuple[float, float, float]:
    """Extrae duplicated_blocks, duplicated_lines y density de un componente de Sonar."""
    measures = {
        metric.get("metric", ""): metric.get("value", "0")
        for metric in component.get("measures", [])
    }
    duplicated_blocks = float(measures.get("duplicated_blocks", "0") or "0")
    duplicated_lines = float(measures.get("duplicated_lines", "0") or "0")
    density = float(measures.get("duplicated_lines_density", "0") or "0")
    return duplicated_blocks, duplicated_lines, density


def _build_duplication_file_entry(
    component: dict, duplicated_blocks: float, duplicated_lines: float, density: float
) -> dict[str, str]:
    """Construye la entrada serializable para un archivo con duplicación."""
    return {
        "key": component.get("key", ""),
        "name": component.get("name", ""),
        "path": component.get("path", component.get("key", "")),
        "duplicated_blocks": str(int(duplicated_blocks)),
        "duplicated_lines": str(int(duplicated_lines)),
        "density": f"{density:.1f}",
    }


def _get_project_duplication_summary() -> dict[str, str]:
    """Obtiene las métricas globales de duplicación del proyecto desde Sonar."""
    response = sonar_get(
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
        response = sonar_get(
            "/api/measures/component_tree",
            {
                "component": PROJECT_KEY,
                "metricKeys": "duplicated_lines,duplicated_blocks,duplicated_lines_density",
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
            blocks, lines, density = _parse_duplication_measures(component)
            if blocks <= 0 and lines <= 0:
                continue
            duplicated_files.append(
                _build_duplication_file_entry(component, blocks, lines, density)
            )

        paging = payload.get("paging", {})
        total = int(paging.get("total", 0) or 0)
        if page * page_size >= total:
            break
        page += 1

    return duplicated_files


# =========================
# RENDERIZADO DE SECCIÓN
# =========================


def _resolve_duplication_block_file(
    current_file_key: str, files_map: dict[str, dict], block: dict
) -> str:
    """Resuelve el archivo asociado a un bloque de duplicación según API de SonarQube."""
    ref = block.get("_ref")
    if ref is not None:
        file_info = files_map.get(str(ref), {})
        if file_info:
            return file_info.get("key", file_info.get("name", current_file_key))
    return current_file_key


def _build_summary_header_lines(
    project_summary: dict[str, str], has_files: bool
) -> list[str]:
    """Construye las líneas de encabezado del reporte de duplicación."""
    lines: list[str] = ["=== Código duplicado (SonarQube) ==="]
    if project_summary:
        lines.append(
            "Resumen del proyecto: "
            f"bloques={project_summary.get('duplicated_blocks', '0')} | "
            f"líneas={project_summary.get('duplicated_lines', '0')} | "
            f"densidad={project_summary.get('duplicated_lines_density', '0')}%"
        )
    else:
        lines.append("Resumen del proyecto: no disponible desde Sonar.")
    if not has_files:
        lines.append(
            "No se encontraron archivos con duplicación visible en la respuesta de Sonar."
        )
    return lines


def _build_high_density_lines(duplicated_files: list[dict[str, str]]) -> list[str]:
    """Construye la lista de archivos con densidad de duplicación superior al umbral."""
    high_density_files = [
        f
        for f in duplicated_files
        if float(f.get("density", "0") or "0") > DENSITY_THRESHOLD
    ]
    if not high_density_files:
        return []

    lines: list[str] = [
        "",
        f"Archivos con densidad de duplicación > {DENSITY_THRESHOLD}%:",
    ]
    for hdf in sorted(
        high_density_files, key=lambda x: float(x.get("density", "0")), reverse=True
    ):
        lines.append(
            f"  - {hdf['path']} | densidad={hdf['density']}%"
            f" | líneas={hdf['duplicated_lines']} | bloques={hdf['duplicated_blocks']}"
        )
    return lines


def _build_blocks_for_duplication(
    duplication: dict, file_key: str, files_map: dict[str, dict]
) -> list[str]:
    """Construye las líneas de detalle para cada bloque de una duplicación."""
    lines: list[str] = []
    for block in duplication.get("blocks", []):
        origin_file = _resolve_duplication_block_file(file_key, files_map, block)
        start_line = block.get("from", "N/A")
        end_line = block.get("to", block.get("from", "N/A"))
        size = block.get("size", "N/A")
        lines.append(
            f"  - {origin_file} | líneas {start_line}-{end_line} | tamaño {size}"
        )
    return lines


def _build_detail_lines_for_file(file_key: str) -> list[str]:
    """Obtiene y formatea los bloques de duplicación para un archivo específico."""
    if not file_key:
        return ["  No se pudo resolver la clave del archivo en Sonar."]

    response = sonar_get("/api/duplications/show", {"key": file_key})
    if response.status_code != 200:
        return ["  No se pudieron obtener detalles de duplicación para este archivo."]

    data = response.json()
    duplications: list[dict] = data.get("duplications", [])
    # files viene como dict {"1": {"key":...}, "2": {...}} en la API de SonarQube
    raw_files = data.get("files", {})
    files_map: dict[str, dict] = raw_files if isinstance(raw_files, dict) else {}

    if not duplications:
        return ["  Sonar reporta duplicación, pero no devolvió bloques detallados."]

    lines: list[str] = []
    for duplication in duplications:
        lines.extend(_build_blocks_for_duplication(duplication, file_key, files_map))
    return lines


def _build_single_file_duplication_lines(duplicated_file: dict[str, str]) -> list[str]:
    """Construye todas las líneas del reporte para un archivo con duplicación."""
    file_key = duplicated_file.get("key", "")
    file_path = duplicated_file.get("path", file_key)
    duplicated_blocks = duplicated_file.get("duplicated_blocks", "0")
    duplicated_lines = duplicated_file.get("duplicated_lines", "0")
    density_val = duplicated_file.get("density", "0")

    lines: list[str] = [
        "",
        f"Archivo: {file_path}",
        f"Duplicated blocks: {duplicated_blocks} | Duplicated lines: {duplicated_lines}"
        f" | Density: {density_val}%",
    ]
    lines.extend(_build_detail_lines_for_file(file_key))
    lines.append("----------------------------------------")
    return lines


def get_sonar_duplicate_code_section() -> str:
    """Construye la sección de código duplicado del reporte desde la API de Sonar."""
    duplicated_files = _get_project_files_with_duplication()
    project_summary = _get_project_duplication_summary()

    section_lines: list[str] = _build_summary_header_lines(
        project_summary, bool(duplicated_files)
    )
    if not duplicated_files:
        return "\n".join(section_lines).strip()

    section_lines.extend(_build_high_density_lines(duplicated_files))
    for duplicated_file in duplicated_files:
        section_lines.extend(_build_single_file_duplication_lines(duplicated_file))

    return "\n".join(section_lines).strip()
